"""FastMCP tool definitions for the Batch Review MCP server.

These tools expose the same capabilities as the REST API so that AI agents
(e.g., Claude, Cursor) can perform collaborative code reviews alongside humans.
All UI-mutating tools also broadcast WebSocket events so the browser updates live.
"""
from __future__ import annotations

import json
from typing import Optional

from fastmcp import FastMCP

from backend.models import WsEvent

mcp = FastMCP(
    name="Batch Review",
    instructions=(
        "Review-first tools for markdown files and code changes in a git repository. "
        "Start with git review context via get_git_changes() and get_git_diff(path), then use "
        "structured file reads only when extra context is needed. Manage review comments "
        "(add, update, delete, list, load saved reviews, save), drive the shared browser UI "
        "(open, close, highlight, jump), read server config, and get the web UI URL. "
        "Directory listing is provided only as a navigation helper, not as a general-purpose "
        "filesystem API. The MCP resource ``batch-review://server/urls`` exposes the same "
        "connection URLs as JSON for hosts that read resources. UI-mutating tools broadcast "
        "WebSocket events; comment mutations also show a short notice in the browser."
    ),
)


# ---------------------------------------------------------------------------
# Helper — lazy import of state to avoid circular imports at module load time
# ---------------------------------------------------------------------------

def _state():
    from backend.state import get_state
    return get_state()


async def _agent_notice(state, message: str) -> None:
    """Toast-style message for connected browser clients (right panel)."""
    await state.broadcast(WsEvent(type="agent_notice", payload={"message": message}))


def _review_connection_urls() -> dict:
    """Shared payload for ``get_review_web_url`` and the ``batch-review://server/urls`` resource."""
    state = _state()
    base = state.web_app_url
    if not base:
        return {
            "web_ui": None,
            "websocket": None,
            "mcp_http": None,
            "error": "Web UI URL is not set yet (HTTP server has not registered the base URL).",
        }
    ws = base.replace("http://", "ws://", 1).replace("https://", "wss://", 1) + "/ws"
    return {
        "web_ui": base,
        "websocket": ws,
        "mcp_http": f"{base}/mcp",
    }


# ---------------------------------------------------------------------------
# File system tools
# ---------------------------------------------------------------------------

@mcp.tool
def list_directory(path: str = ".") -> list[dict]:
    """List files and directories in the repository.

    Args:
        path: Relative path within the repo root (default: repo root).

    Returns:
        List of FileInfo dicts with keys: name, path, is_dir, language, children.
    """
    from backend.api.files import _build_tree
    state = _state()
    try:
        target = state.resolve_safe_path(path)
    except ValueError as exc:
        return [{"error": str(exc)}]
    if not target.is_dir():
        return [{"error": "Path is not a directory"}]
    items = _build_tree(target, state.repo_root)
    return [item.model_dump() for item in items]


@mcp.tool
def get_file_content(path: str) -> dict:
    """Read a file and return the same structure as the REST API / UI viewer.

    Args:
        path: Relative path to the file within the repo root.

    Returns:
        Dict with keys: content, line_count, language, path. On error, {"error": "..."}.
    """
    from backend.api.files import file_content_model_for_path

    try:
        model = file_content_model_for_path(path)
    except ValueError as exc:
        return {"error": str(exc)}
    except FileNotFoundError:
        return {"error": "File not found"}
    except OSError as exc:
        return {"error": f"Cannot read file: {exc}"}
    return model.model_dump()


# ---------------------------------------------------------------------------
# Git tools
# ---------------------------------------------------------------------------

@mcp.tool
def get_git_changes() -> list[dict]:
    """Return a list of files changed relative to the last commit (HEAD).

    Returns:
        List of GitChange dicts with keys: path, status.
        Status values: M=modified, A=added, D=deleted, R=renamed, ?=untracked.
    """
    from backend.api.git_ops import git_changes
    changes = git_changes()
    return [c.model_dump() for c in changes]


@mcp.tool
def get_git_diff(path: str) -> dict:
    """Return the diff for a specific file.

    Args:
        path: Relative path to the file.

    Returns:
        Dict with keys: path, original (HEAD content), modified (working tree), diff (unified).
    """
    from backend.api.git_ops import git_diff
    result = git_diff(path=path)
    return result.model_dump()


# ---------------------------------------------------------------------------
# UI control tools (broadcasts to browser via WebSocket)
# ---------------------------------------------------------------------------

@mcp.tool
async def open_file_in_ui(path: str, mode: str = "view") -> str:
    """Open a file in the browser UI center panel.

    Args:
        path: Relative path to the file within the repo.
        mode: "view" for normal view or "diff" for git diff view.

    Returns:
        Confirmation message.
    """
    state = _state()
    await state.broadcast(WsEvent(type="open_file", payload={"path": path, "mode": mode}))
    return f"Opened {path} in UI (mode={mode})"


@mcp.tool
async def highlight_in_ui(path: str, line_start: int, line_end: int) -> str:
    """Scroll and highlight a line range in the browser UI.

    Args:
        path: Relative path to the file.
        line_start: First line number (1-based).
        line_end: Last line number (1-based, inclusive).

    Returns:
        Confirmation message.
    """
    state = _state()
    await state.broadcast(
        WsEvent(
            type="highlight",
            payload={"path": path, "line_start": line_start, "line_end": line_end},
        )
    )
    return f"Highlighted {path}:L{line_start}-{line_end} in UI"


@mcp.tool
async def close_file_in_ui() -> str:
    """Clear the center panel (same effect as having no file selected)."""
    state = _state()
    await state.broadcast(WsEvent(type="close_file", payload=None))
    return "Closed file in UI"


@mcp.tool
async def set_left_panel_tab(tab: str) -> str:
    """Switch the left sidebar tab between the file tree and git changes.

    Args:
        tab: Either "files" or "git".
    """
    state = _state()
    normalized = tab.strip().lower()
    if normalized not in ("files", "git"):
        return 'Error: tab must be "files" or "git"'
    await state.broadcast(WsEvent(type="set_left_tab", payload={"tab": normalized}))
    return f"Left panel tab set to {normalized}"


@mcp.tool
async def jump_to_comment_in_ui(comment_id: str) -> str:
    """Open the file and highlight the line range for a comment (like clicking @file:L…).

    Args:
        comment_id: UUID of an existing comment from list_comments.
    """
    state = _state()
    comment = state.comments.get(comment_id)
    if comment is None:
        return f"Error: comment {comment_id} not found"
    await state.broadcast(
        WsEvent(
            type="highlight",
            payload={
                "path": comment.file_path,
                "line_start": comment.line_start,
                "line_end": comment.line_end,
            },
        )
    )
    return f"Jumped to {comment.reference} in UI"


# ---------------------------------------------------------------------------
# Comment tools
# ---------------------------------------------------------------------------

@mcp.tool
async def add_comment(
    file_path: str,
    line_start: int,
    line_end: int,
    text: str = "",
    highlighted_text: str = "",
    region_x1: float | None = None,
    region_y1: float | None = None,
    region_x2: float | None = None,
    region_y2: float | None = None,
) -> dict:
    """Add a review comment for a specific line range in a file.

    Args:
        file_path: Relative path to the file being reviewed.
        line_start: First line number (1-based).
        line_end: Last line number (1-based, inclusive).
        text: Review comment text.
        highlighted_text: The verbatim source text that the comment refers to.
        region_x1: Left edge of image region in original pixels (optional, for image files).
        region_y1: Top edge of image region in original pixels (optional, for image files).
        region_x2: Right edge of image region in original pixels (optional, for image files).
        region_y2: Bottom edge of image region in original pixels (optional, for image files).

    Returns:
        The created Comment as a dict.
    """
    state = _state()
    comment = state.add_comment(
        file_path=file_path,
        line_start=line_start,
        line_end=line_end,
        text=text,
        highlighted_text=highlighted_text,
        region_x1=region_x1,
        region_y1=region_y1,
        region_x2=region_x2,
        region_y2=region_y2,
    )
    await state.broadcast(WsEvent(type="add_comment", payload=comment.model_dump()))
    await _agent_notice(state, f"Agent added comment {comment.reference}")
    return comment.model_dump()


@mcp.tool
def list_comments() -> list[dict]:
    """List all current review comments.

    Returns:
        List of Comment dicts.
    """
    state = _state()
    return [c.model_dump() for c in state.comments.values()]


@mcp.tool
async def delete_comment(comment_id: str) -> str:
    """Delete a review comment by its ID.

    Args:
        comment_id: The UUID of the comment to delete.

    Returns:
        Confirmation or error message.
    """
    state = _state()
    if state.delete_comment(comment_id):
        await state.broadcast(WsEvent(type="delete_comment", payload={"id": comment_id}))
        await _agent_notice(state, "Agent deleted a review comment")
        return f"Deleted comment {comment_id}"
    return f"Comment {comment_id} not found"


@mcp.tool
async def update_comment(comment_id: str, text: str) -> dict:
    """Change the body text of an existing comment (same as editing in the UI).

    Args:
        comment_id: UUID of the comment.
        text: New comment text.

    Returns:
        Updated Comment dict, or {\"error\": \"...\"} if not found.
    """
    state = _state()
    updated = state.update_comment_text(comment_id, text)
    if updated is None:
        return {"error": f"Comment {comment_id} not found"}
    await state.broadcast(WsEvent(type="add_comment", payload=updated.model_dump()))
    await _agent_notice(state, f"Agent updated comment {updated.reference}")
    return updated.model_dump()


@mcp.tool
def save_comments(
    output_stem: Optional[str] = None,
    output_dir: Optional[str] = None,
) -> dict:
    """Save all review comments to both a JSON file and a Markdown report.

    Args:
        output_stem: Base filename without extension (server default from config).
        output_dir: Directory to write output files into (server default from config).

    Returns:
        Dict with keys: json_path, md_path, comments (list of comment dicts).
    """
    state = _state()
    return state.save_comments(output_stem=output_stem, output_dir=output_dir)


@mcp.tool
def get_config() -> dict:
    """Return save/load defaults and the web UI base URL when known."""
    state = _state()
    return {
        "output_stem": state.output_stem,
        "output_dir": str(state.output_dir),
        "web_ui_url": state.web_app_url,
    }


@mcp.tool
def get_review_web_url() -> dict:
    """Return URLs for the Batch Review web UI, browser WebSocket, and HTTP MCP mount.

    Use this to share the review app link with a user or to call MCP over HTTP on the
    same server. Values are null until the HTTP server has bound (set at process startup).
    The same JSON is available as MCP resource ``batch-review://server/urls``.
    """
    return _review_connection_urls()


@mcp.resource(
    "batch-review://server/urls",
    name="batch_review_server_urls",
    title="Batch Review server URLs",
    description=(
        "JSON with web_ui (browser app), websocket (live UI sync), and mcp_http "
        "(streamable HTTP MCP on the same host). Use resources/read with this URI."
    ),
    mime_type="application/json",
)
def resource_batch_review_server_urls() -> str:
    """MCP resource mirroring ``get_review_web_url`` for clients that prefer resources/list."""
    return json.dumps(_review_connection_urls(), indent=2)


@mcp.tool
def list_review_files() -> list[str]:
    """List base names of saved ``*.json`` review files in output_dir (for load_review_by_stem)."""
    state = _state()
    return state.list_review_stems()


@mcp.tool
async def load_review_by_stem(stem: str) -> list[dict]:
    """Replace in-memory comments from ``{stem}.json`` under output_dir (same as UI Load).

    Args:
        stem: Filename stem without ``.json`` (must not contain path separators).

    Returns:
        List of loaded Comment dicts, or ``[{\"error\": \"...\"}]`` on failure.
    """
    state = _state()
    try:
        loaded = state.load_review_from_stem(stem)
    except (ValueError, FileNotFoundError) as exc:
        return [{"error": str(exc)}]
    except Exception as exc:
        return [{"error": f"Failed to read file: {exc}"}]
    await state.broadcast(
        WsEvent(
            type="refresh_comments",
            payload=[c.model_dump() for c in loaded],
        )
    )
    await _agent_notice(state, f"Agent loaded review '{stem}' ({len(loaded)} comment(s))")
    return [c.model_dump() for c in loaded]


@mcp.tool
async def refresh_file_tree() -> str:
    """Broadcast a file tree refresh event to all connected browser clients.

    Causes the Files tab in the UI to reload its directory listing immediately.

    Returns:
        Confirmation message.
    """
    state = _state()
    await state.broadcast(WsEvent(type="refresh_files", payload=None))
    return "File tree refresh broadcast sent to all connected clients"
