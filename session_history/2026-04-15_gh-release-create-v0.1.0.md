# Session: Create GitHub Release v0.1.0 with gh CLI

## Agent harness
- Harness: Cursor (agent mode)

## Model
- Model: (per Cursor routing)
- Provider: Cursor

## Token usage
- (approximate) ~4,000 input / ~1,000 output

## Prompt / conversation

### User
Create the GitHub release by hand using gh CLI.

### Agent
Ran `npm ci` / `npm run build` in `frontend/`, `uv build`, and `scripts/build_mcpb.py`; updated `server.json` `fileSha256` to match the new Windows-built `.mcpb`; ran `gh release create v0.1.0` uploading the `.mcpb`, wheel, and sdist.

## Files changed
- `server.json` — `fileSha256` aligned to release artifact bytes
- `session_history/2026-04-15_gh-release-create-v0.1.0.md` — this file

## Reproduction steps
1. Build `dist/` artifacts (frontend + `uv build` + `scripts/build_mcpb.py`).
2. `sha256sum dist/batch-review-mcp-0.1.0.mcpb` and set `server.json` `fileSha256`.
3. `gh release create v0.1.0 --generate-notes dist/batch-review-mcp-0.1.0.mcpb dist/batch_review_mcp-0.1.0-py3-none-any.whl dist/batch_review_mcp-0.1.0.tar.gz`
