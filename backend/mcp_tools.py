"""FastMCP tool definitions for the Batch Review MCP server.

These tools expose the same capabilities as the REST API so that AI agents
(e.g., Claude, Cursor) can perform collaborative code reviews alongside humans.
All UI-mutating tools also broadcast WebSocket events so the browser updates live.
"""
from __future__ import annotations

from typing import Any, Optional

from fastmcp import FastMCP

mcp = FastMCP(
    name="Batch Review",
    instructions=(
        "Tools for reviewing markdown files and code changes in a git repository. "
        "Use these tools to list files, read content, inspect git diffs, add review "
        "comments, and save the final review. UI-mutating tools broadcast live updates "
        "to any connected browser session."
    ),
)


# ---------------------------------------------------------------------------
# Helper — lazy import of state to avoid circular imports at module load time
# ---------------------------------------------------------------------------

def _state():
    from backend.state import get_state
    return get_state()


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
def read_file(path: str) -> str:
    """Read and return the text content of a file in the repository.

    Args:
        path: Relative path to the file within the repo root.

    Returns:
        Full text content of the file.
    """
    state = _state()
    try:
        resolved = state.resolve_safe_path(path)
    except ValueError as exc:
        return f"Error: {exc}"
    if not resolved.exists():
        return "Error: File not found"
    if resolved.is_dir():
        return "Error: Path is a directory"
    return resolved.read_text(encoding="utf-8", errors="replace")


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
    from backend.models import WsEvent
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
    from backend.models import WsEvent
    state = _state()
    await state.broadcast(
        WsEvent(
            type="highlight",
            payload={"path": path, "line_start": line_start, "line_end": line_end},
        )
    )
    return f"Highlighted {path}:L{line_start}-{line_end} in UI"


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
) -> dict:
    """Add a review comment for a specific line range in a file.

    Args:
        file_path: Relative path to the file being reviewed.
        line_start: First line number (1-based).
        line_end: Last line number (1-based, inclusive).
        text: Review comment text.
        highlighted_text: The verbatim source text that the comment refers to.

    Returns:
        The created Comment as a dict.
    """
    from backend.models import WsEvent
    state = _state()
    comment = state.add_comment(
        file_path=file_path,
        line_start=line_start,
        line_end=line_end,
        text=text,
        highlighted_text=highlighted_text,
    )
    await state.broadcast(WsEvent(type="add_comment", payload=comment.model_dump()))
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
    from backend.models import WsEvent
    state = _state()
    if state.delete_comment(comment_id):
        await state.broadcast(WsEvent(type="delete_comment", payload={"id": comment_id}))
        return f"Deleted comment {comment_id}"
    return f"Comment {comment_id} not found"


@mcp.tool
def save_comments(
    output_stem: Optional[str] = None,
    output_dir: Optional[str] = None,
) -> dict:
    """Save all review comments to both a JSON file and a Markdown report.

    Args:
        output_stem: Base filename without extension (default: review_comments).
        output_dir: Directory to write output files into (default: repo root).

    Returns:
        Dict with keys: json_path, md_path, comments (list of comment dicts).
    """
    state = _state()
    return state.save_comments(output_stem=output_stem, output_dir=output_dir)


@mcp.tool
async def refresh_file_tree() -> str:
    """Broadcast a file tree refresh event to all connected browser clients.

    Causes the Files tab in the UI to reload its directory listing immediately.

    Returns:
        Confirmation message.
    """
    from backend.models import WsEvent
    state = _state()
    await state.broadcast(WsEvent(type="refresh_files", payload=None))
    return "File tree refresh broadcast sent to all connected clients"
