"""Review comments REST endpoints."""
from __future__ import annotations

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
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
        anchor_kind=body.anchor_kind,
        html_selector=body.html_selector,
        html_fingerprint=body.html_fingerprint,
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


@router.post("/{comment_id}/refresh-anchor", response_model=Comment)
async def refresh_comment_anchor(comment_id: str) -> Comment:
    """Capture the current on-disk text at this comment's range and clear ``outdated``."""
    state = get_state()
    comment = state.comments.get(comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    try:
        refreshed = state.refresh_comment_highlighted_text(comment_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Cannot read file: {exc}") from exc
    if refreshed is None:
        raise HTTPException(status_code=404, detail="Comment not found")
    await state.broadcast(WsEvent(type="add_comment", payload=refreshed.model_dump()))
    return refreshed


@router.post("/{comment_id}/region-screenshot", response_model=Comment)
async def upload_region_screenshot(
    comment_id: str,
    file: UploadFile = File(...),
    width: int | None = Form(default=None),
    height: int | None = Form(default=None),
) -> Comment:
    """Attach a PNG screenshot to an HTML or PDF region comment."""
    state = get_state()
    if file.content_type not in {None, "", "image/png"}:
        raise HTTPException(status_code=400, detail="Region screenshot must be a PNG image.")
    data = await file.read()
    try:
        comment = state.attach_region_screenshot(comment_id, data, width=width, height=height)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save screenshot: {exc}") from exc
    if comment is None:
        raise HTTPException(status_code=404, detail="Comment not found")
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


# ---------------------------------------------------------------------------
# CLI / agent UI-control endpoints (mirror the MCP-only UI tools, ungated)
#
# These let the batch-review CLI client drive the browser UI the same way the
# MCP tools do. They broadcast the same WsEvent types so the frontend reacts
# identically whether the trigger is a human, an MCP tool call, or a CLI verb.
# ---------------------------------------------------------------------------


@util_router.post("/ui/open")
async def ui_open_file(body: dict) -> JSONResponse:
    """Open a file in the browser UI center panel (mirrors open_file_in_ui MCP tool).

    Body: ``{"path": str, "mode": "view" | "diff"}``
    """
    state = get_state()
    path = body.get("path")
    if not path:
        raise HTTPException(status_code=400, detail="path is required")
    mode = body.get("mode", "view")
    await state.broadcast(WsEvent(type="open_file", payload={"path": path, "mode": mode}))
    return JSONResponse({"ok": True, "path": path, "mode": mode})


@util_router.post("/ui/highlight")
async def ui_highlight(body: dict) -> JSONResponse:
    """Scroll to and highlight a location in the browser UI (mirrors highlight_in_ui).

    Body fields (all optional except ``path``):
      - ``path`` (required): file path relative to repo root.
      - ``line_start``, ``line_end``: 1-based line range for source files.
      - ``pdf_page``: 1-based page index for PDF region highlights.
      - ``region_x1``–``region_y2``: PDF (0–1 fractions) or image (pixels).
    """
    state = get_state()
    path = body.get("path")
    if not path:
        raise HTTPException(status_code=400, detail="path is required")
    await state.broadcast(
        WsEvent(type="highlight", payload={k: v for k, v in body.items()})
    )
    return JSONResponse({"ok": True, "path": path})


@util_router.post("/ui/jump")
async def ui_jump_to_comment(body: dict) -> JSONResponse:
    """Open and highlight the anchor for an existing comment (mirrors jump_to_comment_in_ui).

    Body: ``{"comment_id": str}``
    """
    state = get_state()
    comment_id = body.get("comment_id")
    if not comment_id:
        raise HTTPException(status_code=400, detail="comment_id is required")
    comment = state.comments.get(comment_id)
    if comment is None:
        raise HTTPException(status_code=404, detail=f"Comment {comment_id} not found")
    await state.broadcast(
        WsEvent(
            type="highlight",
            payload={
                "path": comment.file_path,
                "line_start": comment.line_start,
                "line_end": comment.line_end,
                "region_x1": comment.region_x1,
                "region_y1": comment.region_y1,
                "region_x2": comment.region_x2,
                "region_y2": comment.region_y2,
                "pdf_page": comment.pdf_page,
                "highlighted_text": comment.highlighted_text,
            },
        )
    )
    return JSONResponse({"ok": True, "comment_id": comment_id, "reference": comment.reference})


@util_router.post("/session/init")
async def init_session(body: dict) -> JSONResponse:
    """Register an agent client with the server (mirrors init_batch_review_session MCP tool).

    Body: ``{"coding_agent": str, "model_name"?: str, "client_version"?: str}``

    Unlike the MCP tool, this endpoint is ungated — all REST routes work without it.
    But calling it lets the UI show which agent is connected.
    """
    state = get_state()
    coding_agent = body.get("coding_agent", "")
    try:
        info = state.register_mcp_session(
            coding_agent=coding_agent,
            model_name=body.get("model_name", ""),
            client_version=body.get("client_version", ""),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    await state.broadcast(WsEvent(type="mcp_session", payload=dict(info)))
    return JSONResponse({"ok": True, **info})
