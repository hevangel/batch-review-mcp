"""Application singleton state shared between FastAPI routes and MCP tools."""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import TYPE_CHECKING

from fastapi import WebSocket

from backend.models import Comment, WsEvent

if TYPE_CHECKING:
    pass

logger = logging.getLogger(__name__)


class AppState:
    """Singleton holding runtime state for the review session."""

    def __init__(
        self,
        repo_root: Path,
        output_stem: str = "review_comments",
        output_dir: Path | None = None,
    ) -> None:
        self.repo_root: Path = repo_root.resolve()
        self.output_stem: str = output_stem
        self.output_dir: Path = (output_dir or self.repo_root / "logs" / "batch_review").resolve()
        self.comments: dict[str, Comment] = {}
        self.ws_connections: set[WebSocket] = set()
        #: Base URL of the web UI (``http://host:port``), set when the HTTP server binds.
        self.web_app_url: str | None = None

    # ------------------------------------------------------------------
    # Path helpers
    # ------------------------------------------------------------------

    def resolve_safe_path(self, rel_or_abs: str) -> Path:
        """Resolve a path and verify it stays within repo_root.

        Raises ValueError if the resolved path escapes the repo root.
        """
        candidate = Path(rel_or_abs)
        if not candidate.is_absolute():
            candidate = self.repo_root / candidate
        resolved = candidate.resolve()
        try:
            resolved.relative_to(self.repo_root)
        except ValueError:
            raise ValueError(
                f"Path '{rel_or_abs}' escapes the repository root."
            )
        return resolved

    def set_web_app_url(self, url: str) -> None:
        """Record the public base URL of the FastAPI app (no trailing slash)."""
        self.web_app_url = url.rstrip("/")

    # ------------------------------------------------------------------
    # WebSocket broadcasting
    # ------------------------------------------------------------------

    async def broadcast(self, event: WsEvent) -> None:
        """Send a WsEvent JSON payload to all connected WebSocket clients."""
        if not self.ws_connections:
            return
        message = event.model_dump_json()
        dead: set[WebSocket] = set()
        for ws in self.ws_connections:
            try:
                await ws.send_text(message)
            except Exception:
                dead.add(ws)
        self.ws_connections -= dead

    # ------------------------------------------------------------------
    # Comment helpers
    # ------------------------------------------------------------------

    def build_reference(
        self,
        file_path: str,
        line_start: int,
        line_end: int,
        region_x1: float | None = None,
        region_y1: float | None = None,
        region_x2: float | None = None,
        region_y2: float | None = None,
    ) -> str:
        """Build the @filename:L10-15 or @image.png:rect(x1,y1,x2,y2) reference string."""
        rel = file_path
        try:
            rel = str(Path(file_path).relative_to(self.repo_root))
        except ValueError:
            pass
        # Image region reference
        if region_x1 is not None and region_y1 is not None and region_x2 is not None and region_y2 is not None:
            return f"@{rel}:rect({int(region_x1)},{int(region_y1)},{int(region_x2)},{int(region_y2)})"
        # No lines (whole-image comment)
        if line_start == 0 and line_end == 0:
            return f"@{rel}"
        if line_start == line_end:
            return f"@{rel}:L{line_start}"
        return f"@{rel}:L{line_start}-{line_end}"

    def add_comment(
        self,
        file_path: str,
        line_start: int,
        line_end: int,
        text: str = "",
        highlighted_text: str = "",
        region_x1: float | None = None,
        region_y1: float | None = None,
        region_x2: float | None = None,
        region_y2: float | None = None,
    ) -> Comment:
        """Create and store a new comment."""
        reference = self.build_reference(
            file_path, line_start, line_end,
            region_x1=region_x1, region_y1=region_y1,
            region_x2=region_x2, region_y2=region_y2,
        )
        comment = Comment(
            file_path=file_path,
            line_start=line_start,
            line_end=line_end,
            reference=reference,
            text=text,
            highlighted_text=highlighted_text,
            region_x1=region_x1,
            region_y1=region_y1,
            region_x2=region_x2,
            region_y2=region_y2,
        )
        self.comments[comment.id] = comment
        return comment

    def delete_comment(self, comment_id: str) -> bool:
        """Remove a comment by ID. Returns True if it existed."""
        if comment_id in self.comments:
            del self.comments[comment_id]
            return True
        return False

    def update_comment_text(self, comment_id: str, text: str) -> Comment | None:
        """Set comment text. Returns the comment if it existed."""
        comment = self.comments.get(comment_id)
        if comment is None:
            return None
        comment.text = text
        return comment

    def list_review_stems(self) -> list[str]:
        """Basenames (without .json) of saved review files in output_dir."""
        return sorted(p.stem for p in self.output_dir.glob("*.json") if p.is_file())

    def load_review_from_stem(self, stem: str) -> list[Comment]:
        """Replace all comments with contents of ``{stem}.json`` under output_dir.

        Raises:
            ValueError: empty/invalid stem.
            FileNotFoundError: JSON file missing.
        """
        if not stem:
            raise ValueError("stem is required")
        if "/" in stem or "\\" in stem or ".." in stem:
            raise ValueError("Invalid stem")
        json_path = self.output_dir / f"{stem}.json"
        if not json_path.exists():
            raise FileNotFoundError(f"Review file '{stem}.json' not found")
        data = json.loads(json_path.read_text(encoding="utf-8"))
        self.comments.clear()
        loaded: list[Comment] = []
        for item in data:
            c = Comment(**item)
            self.comments[c.id] = c
            loaded.append(c)
        return loaded

    def load_initial_review_json_if_present(self) -> int:
        """If ``{output_stem}.json`` exists under ``output_dir``, load it into memory.

        Called once at process startup. Invalid files are skipped with a warning.

        Returns:
            Number of comments loaded, or ``0`` if the file is missing or unusable.
        """
        json_path = self.output_dir / f"{self.output_stem}.json"
        if not json_path.is_file():
            return 0
        try:
            data = json.loads(json_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            logger.warning("Could not read review JSON %s: %s", json_path, exc)
            return 0
        if not isinstance(data, list):
            logger.warning(
                "Existing review file %s is not a JSON array; skipping auto-load",
                json_path.name,
            )
            return 0
        parsed: dict[str, Comment] = {}
        try:
            for item in data:
                c = Comment(**item)
                parsed[c.id] = c
        except Exception as exc:
            logger.warning(
                "Existing review file %s has invalid entries; skipping auto-load: %s",
                json_path.name,
                exc,
            )
            return 0
        self.comments.clear()
        self.comments.update(parsed)
        logger.info(
            "Loaded %d comment(s) from existing %s",
            len(self.comments),
            json_path.name,
        )
        return len(self.comments)

    def save_to_markdown(self, output_path: str | None = None) -> str:
        """Persist comments to a Markdown report and return the path."""
        if output_path is None:
            output_path = str(self.repo_root / "review_comments.md")
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)

        from datetime import datetime, timezone

        now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        count = len(self.comments)

        lines: list[str] = [
            "# Code Review",
            "",
            f"_Generated: {now} — {count} comment(s)_",
            "",
            "---",
        ]

        # Group comments by file
        by_file: dict[str, list] = {}
        for c in self.comments.values():
            by_file.setdefault(c.file_path, []).append(c)

        for file_path, comments in sorted(by_file.items()):
            lines += ["", f"## {file_path}", ""]
            for c in sorted(comments, key=lambda x: x.line_start):
                lines.append(f"### `{c.reference}`")
                # Image region info
                if c.region_x1 is not None:
                    lines.append(
                        f"> **Region:** ({int(c.region_x1)},{int(c.region_y1)})"
                        f"\u2013({int(c.region_x2)},{int(c.region_y2)})"
                    )
                    lines.append(">")
                elif c.highlighted_text:
                    lines.append("> **Highlighted text:**")
                    for hline in c.highlighted_text.splitlines():
                        lines.append(f"> {hline}" if hline else ">")
                    lines.append(">")
                if c.text:
                    for tline in c.text.splitlines():
                        lines.append(f"> {tline}" if tline else ">")
                else:
                    lines.append("> _(no comment text)_")
                lines.append("")
            lines.append("---")

        with out.open("w", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
        logger.info("Saved markdown report to %s", output_path)
        return output_path

    def save_comments(self, output_stem: str | None = None, output_dir: str | None = None) -> dict:
        """Save comments as both JSON and Markdown. Returns dict with both paths and data."""
        stem = output_stem or self.output_stem
        directory = Path(output_dir) if output_dir else self.output_dir
        directory.mkdir(parents=True, exist_ok=True)
        json_path = str(directory / f"{stem}.json")
        md_path = str(directory / f"{stem}.md")
        json_out, data = self._write_json(json_path)
        md_out = self.save_to_markdown(md_path)
        return {"json_path": json_out, "md_path": md_out, "comments": data}

    def save_to_json(self, output_path: str | None = None) -> tuple[str, list[dict]]:
        """Persist comments to a JSON file and return (path, data)."""
        if output_path is None:
            output_path = str(self.output_dir / f"{self.output_stem}.json")
        return self._write_json(output_path)

    def _write_json(self, output_path: str) -> tuple[str, list[dict]]:
        data = [c.model_dump() for c in self.comments.values()]
        out = Path(output_path)
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w", encoding="utf-8") as fh:
            json.dump(data, fh, indent=2, ensure_ascii=False)
        logger.info("Saved %d comments to %s", len(data), output_path)
        return output_path, data


# Module-level singleton — initialised by create_app()
_state: AppState | None = None


def get_state() -> AppState:
    if _state is None:
        raise RuntimeError("AppState has not been initialised. Call init_state() first.")
    return _state


def init_state(
    repo_root: Path,
    output_stem: str = "review_comments",
    output_dir: Path | None = None,
) -> AppState:
    global _state
    _state = AppState(repo_root, output_stem=output_stem, output_dir=output_dir)
    _state.load_initial_review_json_if_present()
    return _state
