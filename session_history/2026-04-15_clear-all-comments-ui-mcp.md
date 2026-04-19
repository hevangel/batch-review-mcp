# Session: Clear all review comments (right panel + MCP)

## Agent harness
- Harness: Cursor agent
- Version: unavailable in session metadata

## Model
- Model: unavailable in session metadata
- Provider: unavailable in session metadata

## Token usage
- Input tokens: unavailable in harness
- Output tokens: unavailable in harness
- Total tokens: unavailable in harness

## Prompt / conversation

### User
Add a clear all button to the review comment right panel on top; update both the UI and the MCP tools.

### Agent
Implemented `DELETE /api/comments/clear`, `state.clear_all_comments()`, frontend `clearAllComments()` API and store `clearComments()`, a top-of-panel **Clear all** button with confirm, MCP tool `clear_all_comments()` with `refresh_comments` broadcast and agent notice, README tool table update, and session history for pre-commit.

## Files changed
- `backend/state.py` — `clear_all_comments()` clears in-memory map and returns count
- `backend/api/reviews.py` — `DELETE /api/comments/clear` + WebSocket `refresh_comments` `[]`
- `frontend/src/api.ts` — `clearAllComments()` HTTP client
- `frontend/src/store.ts` — `clearComments()` resets comments and newest id
- `frontend/src/components/RightPanel/index.tsx` — top **Clear all** control
- `backend/mcp_tools.py` — `clear_all_comments` MCP tool and instructions string
- `README.md` — document `clear_all_comments` and toast behavior
- `session_history/2026-04-15_clear-all-comments-ui-mcp.md` — this file

## Reproduction steps
1. Start the app with comments present (or add via UI/MCP).
2. Open the right panel; use **Clear all** at the top and confirm — list empties; other clients sync via WebSocket.
3. Call MCP `clear_all_comments` — same outcome and agent notice toast.
