# Session: Document default “open browser” behavior

## Agent harness

- Harness: Cursor Agent

## Model

- Not recorded

## Token usage

- Not recorded

## Prompt / conversation

### User

The default is open browser automatically.

### Agent

Clarified in `main.py` argparse help, `schedule_browser_open` docstring, and `README.md` (standalone heading, MCP section heading, CLI flags table, emphasizing omit `--no-browser` for automatic open).

## Files changed

- `main.py`
- `README.md`

## Reproduction steps

1. `uv run batch-review --help` — `--no-browser` help states default is to open the browser.
2. Run without `--no-browser` — browser opens; with `--no-browser` — it does not.
