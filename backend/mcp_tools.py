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
        "**Before any other Batch Review MCP tool** (except ``get_config``, ``get_review_web_url``, "
        "or reading resource ``batch-review://server/urls``), call ``init_batch_review_session`` once "
        "per connection with ``coding_agent`` (e.g. Cursor, Claude Desktop) and optional ``model_name``. "
        "The server rejects other tools until init succeeds. "
        "Then use git review context via get_git_changes() and get_git_diff(path), and structured "
        "file reads only when extra context is needed. Manage review comments "
        "(add, update, delete, clear all, delete outdated, list, recompute stale, load saved reviews, save), drive the shared browser UI "
        "(open, highlight, jump — repeat open_file_in_ui for the same path refreshes the view), read server config, and get the web UI URL. "
        "Directory listing is only a navigation helper, not a general-purpose filesystem API. "
        "The MCP resource ``batch-review://server/urls`` mirrors connection URLs as JSON. "
        "UI-mutating tools broadcast WebSocket events; comment mutations also show a short notice in the browser."
    ),
)


# ---------------------------------------------------------------------------
# Helper — lazy import of state to avoid circular imports at module load time
# ---------------------------------------------------------------------------

def _state():
    from backend.state import get_state
    return get_state()


def _require_mcp_session() -> None:
    if not _state().mcp_session_initialized:
        raise RuntimeError(
            "MCP session not initialized. Call init_batch_review_session(coding_agent=..., "
            "model_name=... (optional), client_version=... (optional)) once before other Batch Review tools."
        )


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
# Session init (must run before other tools; not gated)
# ---------------------------------------------------------------------------

@mcp.tool
async def init_batch_review_session(
    coding_agent: str,
    model_name: str = "",
    client_version: str = "",
) -> dict:
    """Register the host and model using this MCP server for this process.

    Call **once at the start of a session** before ``get_git_changes``, ``add_comment``,
    ``open_file_in_ui``, or any other Batch Review tool (except ``get_config``,
    ``get_review_web_url``, or resource ``batch-review://server/urls``).

    Args:
        coding_agent: Client or editor name (e.g. ``Cursor``, ``Claude Desktop``, ``VS Code``).
        model_name: Active model id if known; empty string if unknown.
        client_version: Optional host version string.

    Returns:
        Dict with ``ok`` true and the stored ``coding_agent``, ``model_name``, ``client_version``,
        or ``{"error": "..."}`` if ``coding_agent`` is missing.
    """
    state = _state()
    try:
        info = state.register_mcp_session(
            coding_agent=coding_agent,
            model_name=model_name,
            client_version=client_version,
        )
    except ValueError as exc:
        return {"error": str(exc)}
    await state.broadcast(WsEvent(type="mcp_session", payload=dict(info)))
    return {"ok": True, **info}


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
    _require_mcp_session()
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
    _require_mcp_session()
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
    _require_mcp_session()
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
    _require_mcp_session()
    from backend.api.git_ops import git_diff
    result = git_diff(path=path)
    return result.model_dump()


# ---------------------------------------------------------------------------
# UI control tools (broadcasts to browser via WebSocket)
# ---------------------------------------------------------------------------

@mcp.tool
async def open_file_in_ui(path: str, mode: str = "view") -> str:
    """Open a file in the browser UI center panel.

    If that file is already open with the same mode, the center view reloads from
    disk (or re-fetches the git diff in diff mode) so edits on disk are visible.

    Args:
        path: Relative path to the file within the repo.
        mode: "view" for normal view or "diff" for git diff view.

    Returns:
        Confirmation message.
    """
    _require_mcp_session()
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
    _require_mcp_session()
    state = _state()
    await state.broadcast(
        WsEvent(
            type="highlight",
            payload={"path": path, "line_start": line_start, "line_end": line_end},
        )
    )
    return f"Highlighted {path}:L{line_start}-{line_end} in UI"


@mcp.tool
async def jump_to_comment_in_ui(comment_id: str) -> str:
    """Open the file and highlight the line range for a comment (like clicking @file:L…).

    Args:
        comment_id: UUID of an existing comment from list_comments.
    """
    _require_mcp_session()
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
    _require_mcp_session()
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
    _require_mcp_session()
    state = _state()
    return [c.model_dump() for c in state.comments.values()]


@mcp.tool
async def recompute_comment_stale() -> list[dict]:
    """Re-scan repository files and refresh each comment's ``outdated`` flag.

    Compares on-disk text at each comment's line range to the stored ``highlighted_text``.
    Same behavior as the web UI **Reload comments** button: updates the browser via WebSocket.

    Returns:
        List of Comment dicts (including updated ``outdated`` booleans).
    """
    _require_mcp_session()
    state = _state()
    state.recompute_all_comment_outdated()
    comments = list(state.comments.values())
    await state.broadcast(
        WsEvent(
            type="refresh_comments",
            payload=[c.model_dump() for c in comments],
        )
    )
    await _agent_notice(state, "Agent refreshed comment outdated markers")
    return [c.model_dump() for c in comments]


@mcp.tool
async def delete_comment(comment_id: str) -> str:
    """Delete a review comment by its ID.

    Args:
        comment_id: The UUID of the comment to delete.

    Returns:
        Confirmation or error message.
    """
    _require_mcp_session()
    state = _state()
    if state.delete_comment(comment_id):
        await state.broadcast(WsEvent(type="delete_comment", payload={"id": comment_id}))
        await _agent_notice(state, "Agent deleted a review comment")
        return f"Deleted comment {comment_id}"
    return f"Comment {comment_id} not found"


@mcp.tool
async def clear_all_comments() -> str:
    """Remove every in-memory review comment at once (same as the UI Clear all button).

    This clears the live session only; it does not delete JSON/Markdown files on disk
    until you call save_comments() again (which would then write empty files).

    Returns:
        A short confirmation including how many comments were removed.
    """
    _require_mcp_session()
    state = _state()
    n = state.clear_all_comments()
    await state.broadcast(WsEvent(type="refresh_comments", payload=[]))
    await _agent_notice(state, f"Agent cleared all review comments ({n} removed)")
    return f"Cleared {n} comment(s)."


@mcp.tool
async def delete_outdated_comments() -> str:
    """Remove every comment marked ``outdated`` (same as the UI Delete outdated button).

    Run ``recompute_comment_stale()`` first so ``outdated`` flags are up to date.

    Returns:
        Short confirmation with how many comments were removed.
    """
    _require_mcp_session()
    state = _state()
    n = state.delete_outdated_comments()
    remaining = list(state.comments.values())
    await state.broadcast(
        WsEvent(
            type="refresh_comments",
            payload=[c.model_dump() for c in remaining],
        )
    )
    await _agent_notice(state, f"Agent removed {n} outdated comment(s)")
    return f"Removed {n} outdated comment(s); {len(remaining)} remain."


@mcp.tool
async def update_comment(comment_id: str, text: str) -> dict:
    """Change the body text of an existing comment (same as editing in the UI).

    Args:
        comment_id: UUID of the comment.
        text: New comment text.

    Returns:
        Updated Comment dict, or {\"error\": \"...\"} if not found.
    """
    _require_mcp_session()
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
    _require_mcp_session()
    state = _state()
    return state.save_comments(output_stem=output_stem, output_dir=output_dir)


@mcp.tool
def get_config() -> dict:
    """Return save/load defaults, the web UI base URL when known, and MCP session metadata if any."""
    state = _state()
    return {
        "output_stem": state.output_stem,
        "output_dir": str(state.output_dir),
        "web_ui_url": state.web_app_url,
        "mcp_session": dict(state.mcp_session_info) if state.mcp_session_info else None,
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
    _require_mcp_session()
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
    _require_mcp_session()
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
