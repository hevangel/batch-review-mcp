"""Pydantic models shared across backend and MCP tools."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from pydantic import BaseModel, Field


class FileInfo(BaseModel):
    name: str
    path: str
    is_dir: bool
    children: Optional[list["FileInfo"]] = None
    children_loaded: Optional[bool] = None
    has_children: Optional[bool] = None
    language: Optional[str] = None


class GitChange(BaseModel):
    path: str
    old_path: Optional[str] = None
    status: str  # "M" modified, "A" added, "D" deleted, "R" renamed, "?" untracked
    base_label: Optional[str] = None
    head_label: Optional[str] = None


class Comment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    file_path: str
    line_start: int
    line_end: int
    reference: str  # "@file:L10-15" | "@img:rect(px)" | "@doc.pdf:p2" | "@doc.pdf:p2:rect(0-1 floats)"
    text: str = ""
    highlighted_text: str = ""
    region_x1: Optional[float] = None
    region_y1: Optional[float] = None
    region_x2: Optional[float] = None
    region_y2: Optional[float] = None
    #: When set with ``region_*``, anchors a PDF highlight on this 1-based page (``region_*`` are 0–1 fractions).
    pdf_page: Optional[int] = None
    #: Optional richer anchor metadata, currently used by rendered HTML comments.
    anchor_kind: Optional[str] = None
    html_selector: Optional[str] = None
    html_fingerprint: Optional[str] = None
    #: PNG filename for a rendered-region screenshot saved beside the review JSON.
    region_screenshot_file: Optional[str] = None
    region_screenshot_width: Optional[int] = None
    region_screenshot_height: Optional[int] = None
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    #: True when on-disk text at ``line_start``–``line_end`` no longer matches ``highlighted_text``.
    outdated: bool = False


class CreateCommentRequest(BaseModel):
    file_path: str
    line_start: int = 0
    line_end: int = 0
    text: str = ""
    highlighted_text: str = ""
    region_x1: Optional[float] = None
    region_y1: Optional[float] = None
    region_x2: Optional[float] = None
    region_y2: Optional[float] = None
    pdf_page: Optional[int] = None
    anchor_kind: Optional[str] = None
    html_selector: Optional[str] = None
    html_fingerprint: Optional[str] = None


class SaveCommentsRequest(BaseModel):
    output_path: Optional[str] = None  # kept for backwards-compat (sets json output path)
    output_stem: Optional[str] = None  # base filename without extension
    output_dir: Optional[str] = None   # directory to write files into


class BulkLoadRequest(BaseModel):
    comments: list[Comment]
    replace: bool = True  # True = replace all existing comments first


class WsEvent(BaseModel):
    """WebSocket event. ``type`` is one of: open_file, add_comment, delete_comment, highlight,
    refresh_comments, refresh_files, close_file, set_left_tab, agent_notice, mcp_session."""

    type: str
    payload: Any = None


class FileContentResponse(BaseModel):
    content: str
    line_count: int
    language: str
    path: str


class DiffResponse(BaseModel):
    path: str
    old_path: Optional[str] = None
    original: str
    modified: str
    diff: str
    base_label: Optional[str] = None
    head_label: Optional[str] = None
    base_ref: Optional[str] = None
    head_ref: Optional[str] = None
