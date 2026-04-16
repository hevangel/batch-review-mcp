# Session: Distribute via MCPB on GitHub releases (registry)

## Agent harness
- Harness: Cursor (agent mode)
- Version: (workspace session)

## Model
- Model: (per Cursor routing)
- Provider: Cursor

## Token usage
- Input tokens: (approximate) ~22,000
- Output tokens: (approximate) ~7,000
- Total tokens: (approximate) ~29,000

## Prompt / conversation

### User
Publish as `.mcpb` on GitHub release instead of PyPI for MCP registry.

### Agent
Added `mcpb/manifest.json` (UV runtime, `batch-review` + `--mcp` + `--no-browser` + user `repo_root`), `scripts/build_mcpb.py` to stage `pyproject.toml`, `main.py`, `backend/`, `frontend/dist/`, `LICENSE` and pack via `npm exec @anthropic-ai/mcpb`. Switched `server.json` to `registryType: "mcpb"` with GitHub release asset URL and `fileSha256`. Removed PyPI-only README `mcp-name` comment; updated registry docs. Added `.github/workflows/release-mcpb.yml` to build and attach `.mcpb` on `v*` tags. Ran `mcp-publisher validate` on `server.json`.

## Files changed
- `mcpb/manifest.json` — MCP Bundle manifest (UV)
- `scripts/build_mcpb.py` — staging + pack + print SHA-256
- `server.json` — MCPB registry entry + hash
- `README.md` — registry instructions for GitHub release + MCPB
- `.github/workflows/release-mcpb.yml` — CI attach `.mcpb` on tag push
- `session_history/2026-04-15_mcpb-github-release-distribution.md` — this file

## Reproduction steps
1. `npm run build` in `frontend/`.
2. `uv run python scripts/build_mcpb.py` from repo root.
3. Update `server.json` `fileSha256` if the bundle changed; validate with `mcp-publisher validate`.
