# Session: Auto-load existing review JSON on server startup

## Agent harness

- Harness: Cursor Agent

## Model

- Not recorded

## Token usage

- Not recorded

## Prompt / conversation

### User

When batch-review starts it should load the review_comments.json file if the file already exists in the out directory.

### Agent

Added `AppState.load_initial_review_json_if_present()` (safe parse, atomic replace) and call it from `init_state()` after constructing state. Documented in `README.md`.

## Files changed

- `backend/state.py`
- `README.md`

## Reproduction steps

1. Save a review so `<output-dir>/<output>.json` exists.
2. Restart `uv run batch-review --root .` — comments should appear without using Load.
