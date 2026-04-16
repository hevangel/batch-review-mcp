# Session: MCP / API — expose Batch Review web UI URL

## Agent harness

- Harness: Cursor Agent

## Model

- Not recorded

## Token usage

- Not recorded

## Prompt / conversation

### User

Can the AI agent get the URL of the batch review webpage?

### Agent

Added `AppState.web_app_url` and `set_web_app_url`; `main.py` sets it (and `BATCH_REVIEW_WEB_URL` for `--dev` reload) after the bind URL is known; `_dev_entry` restores URL after reload. New MCP tool `get_review_web_url`; extended MCP + REST `get_config` with `web_ui_url`. Updated `README.md` and `frontend/src/api.ts` typing.

## Files changed

- `backend/state.py`
- `main.py`
- `backend/_dev_entry.py`
- `backend/mcp_tools.py`
- `backend/api/reviews.py`
- `frontend/src/api.ts`
- `README.md`

## Reproduction steps

1. Start `uv run batch-review --mcp --root . --skip-build`, call MCP `get_review_web_url` — expect `web_ui` like `http://127.0.0.1:PORT`.
2. `GET /api/config` includes `web_ui_url`.
