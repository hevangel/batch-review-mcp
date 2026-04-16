# Session: Open browser when starting MCP stdio mode

## Agent harness

- Harness: Cursor Agent

## Model

- Not recorded

## Token usage

- Not recorded

## Prompt / conversation

### User

When the AI agent starts the batch review MCP server, make it open the browser too.

### Agent

In `main.py` MCP branch, spawn a daemon thread (1.2s delay, same as standalone) that calls `webbrowser.open(url)` unless `--no-browser`. Updated `README.md` and module docstring.

## Files changed

- `main.py`
- `README.md`

## Reproduction steps

1. `uv run batch-review --mcp --root . --skip-build` — browser should open to the app URL.
2. Same with `--no-browser` — browser should not open.
