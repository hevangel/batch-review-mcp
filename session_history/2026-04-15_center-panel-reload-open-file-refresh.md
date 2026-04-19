# Session: Center panel Reload + MCP same-file refresh

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
Add a reload button to the center panel to reload when the file is updated. For the MCP tool, if the open file tool is called on the same file, refresh the center view.

### Agent
Added `centerReloadEpoch` / `bumpCenterReload` and `openFileFromServer` in the store (epoch bumps when server `open_file` repeats the same path+mode). WebSocket `open_file` uses `openFileFromServer`; local UI still uses `openFile` so re-clicking the same tree node does not refetch. Center panel shows a top toolbar with **Reload** and refetches on epoch change; images use a cache-busting query on `imageUrl`. Documented MCP behavior in `open_file_in_ui` docstring, FastMCP instructions, and README.

## Files changed
- `frontend/src/store.ts` — reload epoch, bump, `openFileFromServer`
- `frontend/src/ws.ts` — `open_file` → `openFileFromServer`
- `frontend/src/components/CenterPanel/index.tsx` — toolbar + `centerReloadEpoch` in fetch effect
- `frontend/src/api.ts` — optional `cacheBust` on `imageUrl`
- `frontend/src/components/CenterPanel/ImageViewer.tsx` — pass cache buster into `imageUrl`
- `backend/mcp_tools.py` — docstring + instructions
- `README.md` — `open_file_in_ui` row
- `session_history/2026-04-15_center-panel-reload-open-file-refresh.md` — this file

## Reproduction steps
1. Open a file in the UI; edit it on disk; click **Reload** — content updates.
2. With the same file open, call MCP `open_file_in_ui` with the same path — view refetches without needing a different file first.
