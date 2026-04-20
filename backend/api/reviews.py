"""Review comments REST endpoints."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from backend.models import BulkLoadRequest, Comment, CreateCommentRequest, SaveCommentsRequest, WsEvent
from backend.state import get_state

router = APIRouter(prefix="/api/comments")
util_router = APIRouter(prefix="/api")


@router.get("", response_model=list[Comment])
def list_comments() -> list[Comment]:
    """Return all current review comments."""
    state = get_state()
    return list(state.comments.values())


@router.post("", response_model=Comment, status_code=201)
async def create_comment(body: CreateCommentRequest) -> Comment:
    """Create a new review comment and broadcast to WebSocket clients."""
    state = get_state()
    comment = state.add_comment(
        file_path=body.file_path,
        line_start=body.line_start,
        line_end=body.line_end,
        text=body.text,
        highlighted_text=body.highlighted_text,
        region_x1=body.region_x1,
        region_y1=body.region_y1,
        region_x2=body.region_x2,
        region_y2=body.region_y2,
        pdf_page=body.pdf_page,
    )
    await state.broadcast(WsEvent(type="add_comment", payload=comment.model_dump()))
    return comment


@router.post("/recompute-stale", response_model=list[Comment])
async def recompute_comment_stale() -> list[Comment]:
    """Re-scan files and set ``outdated`` on each comment; broadcast full list to clients."""
    state = get_state()
    state.recompute_all_comment_outdated()
    comments = list(state.comments.values())
    await state.broadcast(
        WsEvent(
            type="refresh_comments",
            payload=[c.model_dump() for c in comments],
        )
    )
    return comments


@router.delete("/clear", status_code=204)
async def clear_all_comments() -> None:
    """Remove all in-memory comments and broadcast an empty list to WebSocket clients."""
    state = get_state()
    state.clear_all_comments()
    await state.broadcast(WsEvent(type="refresh_comments", payload=[]))


@router.delete("/outdated", response_model=list[Comment])
async def delete_outdated_comments() -> list[Comment]:
    """Remove every comment with ``outdated`` true; broadcast the remaining list."""
    state = get_state()
    state.delete_outdated_comments()
    remaining = list(state.comments.values())
    await state.broadcast(
        WsEvent(
            type="refresh_comments",
            payload=[c.model_dump() for c in remaining],
        )
    )
    return remaining


@router.patch("/{comment_id}", response_model=Comment)
async def update_comment(comment_id: str, body: dict) -> Comment:
    """Update the text of an existing comment."""
    state = get_state()
    comment = state.comments.get(comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    if "text" in body:
        state.update_comment_text(comment_id, body["text"])
        comment = state.comments[comment_id]
    await state.broadcast(WsEvent(type="add_comment", payload=comment.model_dump()))
    return comment


@router.delete("/{comment_id}", status_code=204)
async def delete_comment(comment_id: str) -> None:
    """Delete a comment by ID and broadcast."""
    state = get_state()
    if not state.delete_comment(comment_id):
        raise HTTPException(status_code=404, detail="Comment not found")
    await state.broadcast(WsEvent(type="delete_comment", payload={"id": comment_id}))


@router.post("/save")
def save_comments(body: SaveCommentsRequest) -> JSONResponse:
    """Persist comments to JSON + Markdown files and return both paths."""
    state = get_state()
    # Legacy: if output_path is provided, derive stem+dir from it
    if body.output_path:
        from pathlib import Path as _P
        p = _P(body.output_path)
        result = state.save_comments(
            output_stem=p.stem,
            output_dir=str(p.parent),
        )
    else:
        result = state.save_comments(
            output_stem=body.output_stem or None,
            output_dir=body.output_dir or None,
        )
    return JSONResponse(result)


@router.post("/bulk-load", response_model=list[Comment])
async def bulk_load_comments(body: BulkLoadRequest) -> list[Comment]:
    """Load (replace or merge) a list of comments from a client upload.

    Used by the 'Load Review' button in the UI to restore a previously saved JSON.
    """
    state = get_state()
    if body.replace:
        state.comments.clear()
    for c in body.comments:
        state.comments[c.id] = c
    state.recompute_all_comment_outdated()
    all_comments = list(state.comments.values())
    await state.broadcast(
        WsEvent(
            type="refresh_comments",
            payload=[c.model_dump() for c in all_comments],
        )
    )
    return all_comments


# ---------------------------------------------------------------------------
# Utility endpoints (no /api/comments prefix)
# ---------------------------------------------------------------------------


@util_router.get("/config")
def get_config() -> JSONResponse:
    """Return the current server configuration (output_stem, output_dir, web_ui_url, mcp_session)."""
    state = get_state()
    return JSONResponse(
        {
            "output_stem": state.output_stem,
            "output_dir": str(state.output_dir),
            "web_ui_url": state.web_app_url,
            "mcp_session": dict(state.mcp_session_info) if state.mcp_session_info else None,
        }
    )


@util_router.get("/review-files")
def list_review_files() -> JSONResponse:
    """List stems of saved review JSON files in output_dir."""
    state = get_state()
    return JSONResponse(state.list_review_stems())


@util_router.post("/comments/load")
async def load_review_by_stem(body: dict) -> JSONResponse:
    """Load comments from a saved JSON file by stem name, replacing current comments."""
    state = get_state()
    stem = body.get("stem", "")
    try:
        loaded = state.load_review_from_stem(stem)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read file: {exc}") from exc
    state.recompute_all_comment_outdated()
    loaded = list(state.comments.values())
    await state.broadcast(
        WsEvent(
            type="refresh_comments",
            payload=[c.model_dump() for c in loaded],
        )
    )
    return JSONResponse([c.model_dump() for c in loaded])
