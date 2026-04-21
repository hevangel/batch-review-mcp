"""Detect whether review comments still match on-disk file content.

Compares the stored ``highlighted_text`` to the current file slice for ``line_start``–``line_end``.
Because Monaco only persists the selected text (not column bounds), partial-line selections
are matched when the highlight is a *substring* of the joined full lines for that range.
"""
from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from backend.models import Comment

_IMAGE_SUFFIXES = frozenset(
    {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"},
)


def _normalize_snippet(s: str) -> str:
    return (s or "").replace("\r\n", "\n").replace("\r", "\n").rstrip("\n")


def _normalize_internal_ws_preserve_lines(s: str) -> str:
    """Trim each line and collapse runs of spaces/tabs; newlines preserved."""
    raw = (s or "").replace("\r\n", "\n").replace("\r", "\n")
    return "\n".join(" ".join(part.split()) for part in raw.split("\n"))


def _snippet_from_lines(lines: list[str], line_start: int, line_end: int) -> str:
    if line_start < 1 or line_end < line_start:
        return ""
    chunk = lines[line_start - 1 : line_end]
    return "\n".join(chunk)


def current_comment_text(
    resolve_safe_path: Callable[[str], Path],
    comment: Comment,
) -> str:
    """Return the current on-disk text slice for a text comment.

    Raises ValueError when the comment does not point at a refreshable text range.
    Raises FileNotFoundError when the source file is missing.
    Raises OSError when the source file cannot be read.
    """
    path = resolve_safe_path(comment.file_path)
    if not path.is_file():
        raise FileNotFoundError(f"File not found: {comment.file_path}")

    suffix = path.suffix.lower()
    if suffix in _IMAGE_SUFFIXES or comment.pdf_page is not None or comment.region_x1 is not None:
        raise ValueError("Only text comments can refresh highlighted text.")

    if comment.line_start < 1 or comment.line_end < comment.line_start:
        raise ValueError("Comment does not have a valid line range.")

    content = path.read_text(encoding="utf-8", errors="replace")
    lines = content.splitlines()
    if comment.line_start > len(lines) or comment.line_end > len(lines):
        raise ValueError("Comment line range no longer exists in the file.")

    return _snippet_from_lines(lines, comment.line_start, comment.line_end)


def comment_is_outdated(
    resolve_safe_path: Callable[[str], Path],
    comment: Comment,
) -> bool:
    """Return True if the file is missing or the highlighted range no longer matches."""
    try:
        path = resolve_safe_path(comment.file_path)
    except ValueError:
        return True
    if not path.is_file():
        return True

    suffix = path.suffix.lower()
    if suffix in _IMAGE_SUFFIXES:
        return False

    if comment.pdf_page is not None:
        return False

    if comment.region_x1 is not None:
        return False

    if comment.line_start == 0 and comment.line_end == 0:
        return False

    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return True

    lines = content.splitlines()
    if comment.line_start < 1 or comment.line_end < comment.line_start:
        return True
    if comment.line_start > len(lines) or comment.line_end > len(lines):
        return True

    block = _snippet_from_lines(lines, comment.line_start, comment.line_end)
    highlight = comment.highlighted_text or ""

    nb = _normalize_snippet(block)
    nh = _normalize_snippet(highlight)

    if nh == nb:
        return False

    # Empty highlight: we cannot compare to a column-accurate slice (not stored on Comment).
    if nh == "":
        return False

    # Partial-line selections: Monaco stores only selected columns, but line_start/line_end
    # span whole lines. The highlight is always a contiguous slice of the document, so it
    # must appear as a substring of the full-line join when the file is unchanged.
    if nh in nb:
        return False

    # Same text modulo whitespace runs / trailing space on lines (common in LICENSE, etc.)
    if _normalize_internal_ws_preserve_lines(nh) == _normalize_internal_ws_preserve_lines(nb):
        return False

    return True
