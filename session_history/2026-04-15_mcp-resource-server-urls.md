# Session: MCP resource for server URLs

## Agent harness

- Harness: Cursor Agent

## Model

- Not recorded

## Token usage

- Not recorded

## Prompt / conversation

### User

Add the url to mcp server resource.

### Agent

Added `_review_connection_urls()` helper, MCP resource `batch-review://server/urls` (JSON) via `@mcp.resource`, refactored `get_review_web_url` to reuse it; updated instructions, `README.md`, and `scripts/test_mcp_client.py` to list/read resources.

## Files changed

- `backend/mcp_tools.py`
- `README.md`
- `scripts/test_mcp_client.py`

## Reproduction steps

1. `uv run python scripts/test_mcp_client.py` — should list `batch-review://server/urls` and read JSON.
2. MCP client: `resources/read` on URI `batch-review://server/urls`.
