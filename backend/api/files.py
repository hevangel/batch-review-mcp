"""File system REST endpoints."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from backend.models import FileContentResponse, FileInfo
from backend.state import get_state

router = APIRouter(prefix="/api")

# Mapping of file extensions to Monaco / highlight.js language identifiers
_LANG_MAP: dict[str, str] = {
    ".py": "python",
    ".js": "javascript",
    ".jsx": "javascript",
    ".ts": "typescript",
    ".tsx": "typescript",
    ".json": "json",
    ".md": "markdown",
    ".html": "html",
    ".htm": "html",
    ".css": "css",
    ".scss": "scss",
    ".less": "less",
    ".sh": "shell",
    ".bash": "shell",
    ".zsh": "shell",
    ".yaml": "yaml",
    ".yml": "yaml",
    ".toml": "ini",
    ".ini": "ini",
    ".cfg": "ini",
    ".java": "java",
    ".c": "c",
    ".cpp": "cpp",
    ".h": "c",
    ".hpp": "cpp",
    ".rs": "rust",
    ".go": "go",
    ".rb": "ruby",
    ".php": "php",
    ".swift": "swift",
    ".kt": "kotlin",
    ".cs": "csharp",
    ".xml": "xml",
    ".sql": "sql",
    ".r": "r",
    ".dockerfile": "dockerfile",
    ".tf": "hcl",
    ".lua": "lua",
    ".dart": "dart",
    ".vue": "html",
    ".svelte": "html",
}

_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"}

_PDF_EXTENSIONS = {".pdf"}

_IMAGE_MIME: dict[str, str] = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".svg": "image/svg+xml",
    ".ico": "image/x-icon",
}

_IGNORE_DIRS = {
    ".git",
    "node_modules",
    "__pycache__",
    ".venv",
    "venv",
    "dist",
    "build",
    ".next",
    ".nuxt",
    "coverage",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
}


def _detect_language(path: str) -> str:
    suffix = Path(path).suffix.lower()
    name = Path(path).name.lower()
    if name == "dockerfile":
        return "dockerfile"
    if suffix in _IMAGE_EXTENSIONS:
        return "image"
    if suffix in _PDF_EXTENSIONS:
        return "pdf"
    return _LANG_MAP.get(suffix, "plaintext")


def _build_tree(directory: Path, repo_root: Path, depth: int = 0) -> list[FileInfo]:
    """Recursively build a FileInfo tree for the given directory."""
    if depth > 10:
        return []
    items: list[FileInfo] = []
    try:
        entries = sorted(os.scandir(directory), key=lambda e: (not e.is_dir(), e.name.lower()))
    except PermissionError:
        return []
    for entry in entries:
        if entry.name.startswith(".") and entry.name not in (".github",):
            # Skip hidden files/dirs except .github
            if entry.is_dir():
                if entry.name in _IGNORE_DIRS:
                    continue
            else:
                continue
        if entry.is_dir() and entry.name in _IGNORE_DIRS:
            continue
        rel_path = str(Path(entry.path).relative_to(repo_root)).replace("\\", "/")
        if entry.is_dir():
            children = _build_tree(Path(entry.path), repo_root, depth + 1)
            items.append(FileInfo(name=entry.name, path=rel_path, is_dir=True, children=children))
        else:
            items.append(
                FileInfo(
                    name=entry.name,
                    path=rel_path,
                    is_dir=False,
                    language=_detect_language(entry.name),
                )
            )
    return items


@router.get("/files", response_model=list[FileInfo])
def list_files(path: Optional[str] = Query(default=None)) -> list[FileInfo]:
    """Return the directory tree for the given relative path (default: repo root)."""
    state = get_state()
    if path is None or path in (".", ""):
        target = state.repo_root
    else:
        try:
            target = state.resolve_safe_path(path)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    if not target.exists():
        raise HTTPException(status_code=404, detail="Path not found")
    if not target.is_dir():
        raise HTTPException(status_code=400, detail="Path is not a directory")
    return _build_tree(target, state.repo_root)


def file_content_model_for_path(path: str) -> FileContentResponse:
    """Return file content metadata for a repo-relative path.

    Raises:
        ValueError: path escapes repo or is a directory.
        FileNotFoundError: path does not exist.
        OSError: unreadable file.
    """
    state = get_state()
    resolved = state.resolve_safe_path(path)
    if not resolved.exists():
        raise FileNotFoundError("File not found")
    if resolved.is_dir():
        raise ValueError("Path is a directory")
    content = resolved.read_text(encoding="utf-8", errors="replace")
    lines = content.splitlines()
    rel = str(resolved.relative_to(state.repo_root)).replace("\\", "/")
    return FileContentResponse(
        content=content,
        line_count=len(lines),
        language=_detect_language(resolved.name),
        path=rel,
    )


@router.get("/file-content", response_model=FileContentResponse)
def get_file_content(path: str = Query(...)) -> FileContentResponse:
    """Return the text content of a file within the repo."""
    try:
        return file_content_model_for_path(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found")
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Cannot read file: {exc}")


@router.get("/pdf-content")
def get_pdf_content(path: str = Query(...)):
    """Return the raw bytes of a PDF file within the repo."""
    state = get_state()
    try:
        resolved = state.resolve_safe_path(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not resolved.exists():
        raise HTTPException(status_code=404, detail="File not found")
    if resolved.suffix.lower() not in _PDF_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Not a PDF file")
    return FileResponse(str(resolved), media_type="application/pdf")


@router.get("/image-content")
def get_image_content(path: str = Query(...)):
    """Return the raw bytes of an image file within the repo."""
    state = get_state()
    try:
        resolved = state.resolve_safe_path(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    if not resolved.exists():
        raise HTTPException(status_code=404, detail="File not found")
    suffix = resolved.suffix.lower()
    if suffix not in _IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Not an image file")
    media_type = _IMAGE_MIME.get(suffix, "application/octet-stream")
    return FileResponse(str(resolved), media_type=media_type)
