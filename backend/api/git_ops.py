"""Git operations REST endpoints."""
from __future__ import annotations

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from backend.models import DiffResponse, GitChange
from backend.state import get_state

router = APIRouter(prefix="/api/git")
logger = logging.getLogger(__name__)


def _get_repo():
    """Return a GitPython Repo for the repo_root, or raise HTTP 400."""
    try:
        import git  # type: ignore

        state = get_state()
        return git.Repo(state.repo_root, search_parent_directories=True)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Git repo not found: {exc}")


@router.get("/changes", response_model=list[GitChange])
def git_changes() -> list[GitChange]:
    """Return a list of changed files compared to HEAD."""
    repo = _get_repo()
    state = get_state()
    changes: list[GitChange] = []

    try:
        # Staged + unstaged changes vs HEAD
        for diff_item in repo.index.diff("HEAD"):
            status = diff_item.change_type  # A, D, M, R, ...
            path = diff_item.a_path or diff_item.b_path
            changes.append(GitChange(path=path, status=status))
    except Exception:
        # Empty repo or no HEAD
        pass

    try:
        # Unstaged changes (working tree vs index)
        for diff_item in repo.index.diff(None):
            path = diff_item.a_path or diff_item.b_path
            # Avoid duplicates
            existing_paths = {c.path for c in changes}
            if path not in existing_paths:
                changes.append(GitChange(path=path, status=diff_item.change_type))
    except Exception:
        pass

    # Untracked files
    try:
        for upath in repo.untracked_files:
            changes.append(GitChange(path=upath, status="?"))
    except Exception:
        pass

    return changes


@router.get("/diff", response_model=DiffResponse)
def git_diff(path: str = Query(...)) -> DiffResponse:
    """Return original (HEAD), modified (working tree), and unified diff for a file."""
    state = get_state()
    try:
        safe_path = state.resolve_safe_path(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    repo = _get_repo()
    rel_path = str(safe_path.relative_to(state.repo_root)).replace("\\", "/")

    # ---- original content (HEAD) ----------------------------------------
    original = ""
    try:
        blob = repo.head.commit.tree[rel_path]
        original = blob.data_stream.read().decode("utf-8", errors="replace")
    except (KeyError, Exception):
        # File may be untracked / new — original is empty
        original = ""

    # ---- modified content (working tree) -----------------------------------
    modified = ""
    if safe_path.exists():
        try:
            modified = safe_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            pass

    # ---- unified diff ------------------------------------------------------
    import difflib

    diff = "".join(
        difflib.unified_diff(
            original.splitlines(keepends=True),
            modified.splitlines(keepends=True),
            fromfile=f"a/{rel_path}",
            tofile=f"b/{rel_path}",
            lineterm="",
        )
    )

    return DiffResponse(path=rel_path, original=original, modified=modified, diff=diff)
