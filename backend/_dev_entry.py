"""Thin entry-point for uvicorn --reload (dev mode).

Do NOT import this in production.  It reads config from environment variables
set by main.py --dev before launching uvicorn with reload=True.
"""
from __future__ import annotations

import os
from pathlib import Path

from backend.app import create_app

_root = os.environ.get("BATCH_REVIEW_ROOT", ".")
_stem = os.environ.get("BATCH_REVIEW_STEM", "review_comments")
_dir = os.environ.get("BATCH_REVIEW_OUTPUT_DIR", "")

app, _mcp = create_app(
    repo_root=Path(_root),
    output_stem=_stem,
    output_dir=Path(_dir) if _dir else None,
)

# Preserve web UI URL across uvicorn --reload (parent sets BATCH_REVIEW_WEB_URL).
_web_url = os.environ.get("BATCH_REVIEW_WEB_URL", "").strip()
if _web_url:
    from backend.state import get_state

    get_state().set_web_app_url(_web_url)
