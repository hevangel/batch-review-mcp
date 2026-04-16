# Session: Unify --no-browser across standalone, dev, and MCP

## Agent harness

- Harness: Cursor Agent

## Model

- Not recorded

## Token usage

- Not recorded

## Prompt / conversation

### User

Make the `--no-browser` flag behave the same in MCP mode and standalone mode.

### Agent

Introduced `schedule_browser_open()` in `cli_main`: always starts the same daemon thread with a 1.2s delay, then opens the browser only if `not args.no_browser`. Replaced standalone, `--dev`, and `--mcp` branches to use it; updated argparse help text.

## Files changed

- `main.py`

## Reproduction steps

1. Run `uv run batch-review --root . --skip-build --no-browser` — no browser after delay.
2. Run `uv run batch-review --mcp --root . --skip-build --no-browser` — same.
