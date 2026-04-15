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
    language: Optional[str] = None


class GitChange(BaseModel):
    path: str
    status: str  # "M" modified, "A" added, "D" deleted, "R" renamed, "?" untracked


class Comment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    file_path: str
    line_start: int
    line_end: int
    reference: str  # "@filename:L10-15" style
    text: str = ""
    highlighted_text: str = ""
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class CreateCommentRequest(BaseModel):
    file_path: str
    line_start: int
    line_end: int
    text: str = ""
    highlighted_text: str = ""


class SaveCommentsRequest(BaseModel):
    output_path: Optional[str] = None  # kept for backwards-compat (sets json output path)
    output_stem: Optional[str] = None  # base filename without extension
    output_dir: Optional[str] = None   # directory to write files into


class BulkLoadRequest(BaseModel):
    comments: list[Comment]
    replace: bool = True  # True = replace all existing comments first


class WsEvent(BaseModel):
    type: str  # "open_file" | "add_comment" | "delete_comment" | "highlight" | "refresh_comments"
    payload: Any = None


class FileContentResponse(BaseModel):
    content: str
    line_count: int
    language: str
    path: str


class DiffResponse(BaseModel):
    path: str
    original: str
    modified: str
    diff: str
