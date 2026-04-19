# Session: Comment outdated flag + Reload comments

## Prompt
User: update the comment to track whether outdated; if file changed, strikethrough; add reload next to clear all to refresh comment view.

## Change
- `backend/models.py` — `Comment.outdated: bool = False`
- `backend/comment_staleness.py` — compare on-disk line range text to `highlighted_text` (skip images / region comments)
- `backend/state.py` — `recompute_all_comment_outdated()`, call after `init_state` load
- `backend/api/reviews.py` — `POST /api/comments/recompute-stale`; bulk-load + load-by-stem call recompute before broadcast
- `frontend/src/types.ts`, `api.ts`, `CommentBox.tsx`, `RightPanel/index.tsx` — UI + API client
- `backend/mcp_tools.py`, `README.md` — `recompute_comment_stale` MCP tool + docs

## Reproduction
1. Add a line-range comment, edit those lines on disk, click **Reload comments** — reference + body show strikethrough.
2. Save JSON includes `"outdated": true/false`.
