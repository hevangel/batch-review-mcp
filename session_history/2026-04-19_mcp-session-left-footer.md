# Session: MCP agent/model on left footer, aligned panel footers

## Agent harness
- Harness: Cursor (agent)
- Version: (not recorded)

## Model
- Model: (not recorded)
- Provider: (not recorded)

## Token usage
- (not recorded)

## Prompt / conversation

### User
Display the coding agent name and model name on the bottom bar of the left panel; ensure the left and right panel bottoms have the same height.

### Agent
- Backend: `init_batch_review_session` broadcasts WebSocket `mcp_session` with `coding_agent`, `model_name`, `client_version`. REST and MCP `get_config` include `mcp_session` when set.
- Frontend: Zustand `mcpSession` + `setMcpSession`; `App` hydrates from `getConfig`; `ws.ts` handles `mcp_session`. Shared `PANEL_BOTTOM_BAR_CLASS` (`min-h-[3rem]`, padding, border) for left strip and right action row. Right panel notices/paths/errors moved above that bar so the bottom strip matches the left.

## Files changed
- `backend/models.py`, `backend/mcp_tools.py`, `backend/api/reviews.py`
- `frontend/src/types.ts`, `store.ts`, `ws.ts`, `api.ts`, `App.tsx`
- `frontend/src/components/ui/panelBottomBar.ts` (new)
- `frontend/src/components/LeftPanel/index.tsx`, `RightPanel/index.tsx`
- `session_history/2026-04-19_mcp-session-left-footer.md` — this file

## Reproduction steps
1. Run the app, open the UI before MCP init: left footer shows “No MCP session yet”.
2. Call `init_batch_review_session` from an MCP client: left footer updates to agent and model; right bottom bar keeps the same strip height.
3. Refresh the browser after init: `GET /api/config` repopulates the left footer from `mcp_session`.
