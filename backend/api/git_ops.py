"""Git operations REST endpoints."""
from __future__ import annotations

import difflib
import logging
import re
from urllib.parse import urlparse

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


def _blob_text(commit, path: str | None) -> str:
    """Return UTF-8-ish blob text from a commit tree, or empty when absent/binary."""
    if not path:
        return ""
    try:
        blob = commit.tree[path]
        return blob.data_stream.read().decode("utf-8", errors="replace")
    except Exception:
        return ""


def _unified_diff(
    original: str,
    modified: str,
    old_path: str,
    new_path: str,
) -> str:
    return "".join(
        difflib.unified_diff(
            original.splitlines(keepends=True),
            modified.splitlines(keepends=True),
            fromfile=f"a/{old_path}",
            tofile=f"b/{new_path}",
            lineterm="",
        )
    )


def _parse_pr_number(value: str) -> str:
    candidate = (value or "").strip()
    if re.fullmatch(r"\d+", candidate):
        return candidate
    parsed = urlparse(candidate)
    match = re.search(r"/pull/(\d+)(?:/|$)", parsed.path)
    if parsed.netloc.endswith("github.com") and match:
        return match.group(1)
    raise HTTPException(status_code=400, detail="PR must be a GitHub PR number or URL.")


def _remote_slug(url: str) -> str:
    value = url.strip()
    if value.startswith("git@github.com:"):
        value = value.removeprefix("git@github.com:")
    else:
        parsed = urlparse(value)
        value = parsed.path.lstrip("/") if parsed.netloc else value
    return value.removesuffix(".git").lower()


def _select_remote(repo, pr_value: str):
    parsed = urlparse((pr_value or "").strip())
    wanted_slug = ""
    if parsed.netloc.endswith("github.com"):
        parts = parsed.path.strip("/").split("/")
        if len(parts) >= 2:
            wanted_slug = f"{parts[0]}/{parts[1]}".lower()
    remotes = list(repo.remotes)
    if wanted_slug:
        for remote in remotes:
            urls = list(remote.urls)
            if any(_remote_slug(url) == wanted_slug for url in urls):
                return remote
    if "origin" in [remote.name for remote in remotes]:
        return repo.remotes.origin
    if remotes:
        return remotes[0]
    raise HTTPException(status_code=400, detail="No git remote is configured for PR comparison.")


def _resolve_pr_head(repo, pr_value: str) -> tuple[str, str]:
    number = _parse_pr_number(pr_value)
    ref_name = f"refs/batch-review/pr/{number}"
    remote = _select_remote(repo, pr_value)
    try:
        repo.git.fetch(remote.name, f"pull/{number}/head:{ref_name}")
    except Exception as exc:
        try:
            repo.commit(ref_name)
        except Exception:
            raise HTTPException(
                status_code=400,
                detail=f"Failed to fetch PR #{number} from remote '{remote.name}': {exc}",
            ) from exc
    return ref_name, f"PR #{number} head"


def _compare_refs(
    repo,
    mode: str,
    base: str | None,
    head: str | None,
    pr: str | None,
) -> tuple[str, str, str, str]:
    """Return base_ref, head_ref, base_label, head_label for commit-like comparisons."""
    if mode == "commit":
        if not base:
            raise HTTPException(status_code=400, detail="Commit compare requires a base ref.")
        head_ref = head or "HEAD"
        return base, head_ref, f"Base ({base})", f"Current ({head_ref})"
    if mode == "pr":
        if not pr:
            raise HTTPException(status_code=400, detail="PR compare requires a PR number or URL.")
        pr_ref, pr_label = _resolve_pr_head(repo, pr)
        return "HEAD", pr_ref, "Current checkout (HEAD)", pr_label
    raise HTTPException(status_code=400, detail=f"Unsupported git compare mode: {mode}")


def _commit_changes(
    repo,
    base_ref: str,
    head_ref: str,
    base_label: str,
    head_label: str,
) -> list[GitChange]:
    try:
        base_commit = repo.commit(base_ref)
        head_commit = repo.commit(head_ref)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid git ref: {exc}") from exc
    changes: list[GitChange] = []
    for diff_item in base_commit.diff(head_commit, R=True):
        status = diff_item.change_type or "M"
        path = diff_item.a_path if status == "D" else (diff_item.b_path or diff_item.a_path)
        if not path:
            continue
        old_path = diff_item.a_path if status == "R" and diff_item.a_path != diff_item.b_path else None
        changes.append(
            GitChange(
                path=path,
                old_path=old_path,
                status=status,
                base_label=base_label,
                head_label=head_label,
            )
        )
    return changes


@router.get("/changes", response_model=list[GitChange])
def git_changes(
    mode: str = Query(default="local"),
    base: str | None = Query(default=None),
    head: str | None = Query(default=None),
    pr: str | None = Query(default=None),
) -> list[GitChange]:
    """Return a list of changed files compared to HEAD."""
    repo = _get_repo()
    if mode != "local":
        base_ref, head_ref, base_label, head_label = _compare_refs(repo, mode, base, head, pr)
        return _commit_changes(repo, base_ref, head_ref, base_label, head_label)

    changes: list[GitChange] = []
    seen_paths: set[str] = set()
    base_label = "Original (HEAD)"
    head_label = "Modified (working tree)"

    try:
        # Staged + unstaged changes vs HEAD
        for diff_item in repo.index.diff("HEAD"):
            status = diff_item.change_type  # A, D, M, R, ...
            path = diff_item.a_path or diff_item.b_path
            if path:
                changes.append(GitChange(path=path, status=status, base_label=base_label, head_label=head_label))
                seen_paths.add(path)
    except Exception:
        # Empty repo or no HEAD
        pass

    try:
        # Unstaged changes (working tree vs index)
        for diff_item in repo.index.diff(None):
            path = diff_item.a_path or diff_item.b_path
            # Avoid duplicates
            if path and path not in seen_paths:
                changes.append(GitChange(path=path, status=diff_item.change_type, base_label=base_label, head_label=head_label))
                seen_paths.add(path)
    except Exception:
        pass

    # Untracked files
    try:
        for upath in repo.untracked_files:
            changes.append(GitChange(path=upath, status="?", base_label=base_label, head_label=head_label))
    except Exception:
        pass

    return changes


@router.get("/diff", response_model=DiffResponse)
def git_diff(
    path: str = Query(...),
    old_path: str | None = Query(default=None),
    mode: str = Query(default="local"),
    base: str | None = Query(default=None),
    head: str | None = Query(default=None),
    pr: str | None = Query(default=None),
) -> DiffResponse:
    """Return original (HEAD), modified (working tree), and unified diff for a file."""
    state = get_state()
    try:
        safe_path = state.resolve_safe_path(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    repo = _get_repo()
    rel_path = str(safe_path.relative_to(state.repo_root)).replace("\\", "/")
    old_rel_path = (old_path or rel_path).replace("\\", "/")

    if mode != "local":
        base_ref, head_ref, base_label, head_label = _compare_refs(repo, mode, base, head, pr)
        try:
            base_commit = repo.commit(base_ref)
            head_commit = repo.commit(head_ref)
        except Exception as exc:
            raise HTTPException(status_code=400, detail=f"Invalid git ref: {exc}") from exc
        original = _blob_text(base_commit, old_rel_path)
        modified = _blob_text(head_commit, rel_path)
        diff = _unified_diff(original, modified, old_rel_path, rel_path)
        return DiffResponse(
            path=rel_path,
            old_path=old_rel_path if old_rel_path != rel_path else None,
            original=original,
            modified=modified,
            diff=diff,
            base_label=base_label,
            head_label=head_label,
            base_ref=base_ref,
            head_ref=head_ref,
        )

    # ---- original content (HEAD) ----------------------------------------
    original = _blob_text(repo.head.commit, old_rel_path)

    # ---- modified content (working tree) -----------------------------------
    modified = ""
    if safe_path.exists():
        try:
            modified = safe_path.read_text(encoding="utf-8", errors="replace")
        except OSError:
            pass

    diff = _unified_diff(original, modified, old_rel_path, rel_path)

    return DiffResponse(
        path=rel_path,
        old_path=old_rel_path if old_rel_path != rel_path else None,
        original=original,
        modified=modified,
        diff=diff,
        base_label="Original (HEAD)",
        head_label="Modified (working tree)",
        base_ref="HEAD",
        head_ref="working tree",
    )
