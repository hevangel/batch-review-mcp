# Session: Delete outdated button + API + MCP

## Prompt
User: add a delete outdated button between reload comment and clear all.

## Change
- `backend/state.py` — `delete_outdated_comments() -> int`
- `backend/api/reviews.py` — `DELETE /api/comments/outdated` returns remaining comments + `refresh_comments` broadcast
- `frontend/src/api.ts` — `deleteOutdatedComments()`
- `frontend/src/components/RightPanel/index.tsx` — button + confirm between Reload and Clear all
- `backend/mcp_tools.py`, `README.md` — `delete_outdated_comments` tool + docs
