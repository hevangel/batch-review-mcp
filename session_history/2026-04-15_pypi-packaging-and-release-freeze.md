# Session: PyPI packaging (wheel/sdist) and release freeze 0.1.0

## Agent harness
- Harness: Cursor (agent mode)
- Version: (workspace session)

## Model
- Model: (per Cursor routing)
- Provider: Cursor

## Token usage
- Input tokens: (approximate) ~25,000
- Output tokens: (approximate) ~8,000
- Total tokens: (approximate) ~33,000

## Prompt / conversation

### User
Guidance on publishing to PyPI; ensure repo layout fits PyPI expectations; explain prebuilt `frontend/dist` on Linux vs Windows.

### Agent
Explained PyPI workflow and immutability of versions; inspected `pyproject.toml` and wheel contents; identified missing `main.py` and `frontend/dist` in the wheel while the console script required `main`.

### User
Minimal change plan; confirm prebuilt frontend works for pip installs.

### Agent
Proposed Hatch `force-include` for `main.py` and `frontend/dist`, sdist parity, and `npm run build` before `uv build`.

### User
Implement the packaging fix.

### Agent
Updated `pyproject.toml` with `[tool.hatch.build.targets.wheel.force-include]` and `[tool.hatch.build.targets.sdist.force-include]`; verified wheel/sdist and smoke-tested `batch-review --help` after wheel install.

### User
Freeze 0.1.0 and complete pre-publish checks (PyPI name, clean frontend build, `uv build`, dry-run publish, smoke install).

### Agent
Confirmed `https://pypi.org/pypi/batch-review-mcp/json` returns 404 (name not yet registered); ran `npm ci`, `npm run build`, clean `dist/` and `uv build`; `uv publish --dry-run`; fresh-venv wheel install smoke test; prepared commit + tag `v0.1.0` with this session file.

## Files changed
- `pyproject.toml` — Hatch `force-include` for `main.py` and `frontend/dist` on wheel and sdist targets
- `session_history/2026-04-15_pypi-packaging-and-release-freeze.md` — this session record

## Reproduction steps
1. Check out the base commit before the packaging change.
2. In Cursor (or equivalent), ask to add Hatch `force-include` entries for `main.py` and `frontend/dist` under wheel and sdist, matching the final `pyproject.toml`.
3. Run `npm ci` and `npm run build` in `frontend/`, remove `dist/`, then `uv build`.
4. Verify the wheel contains `main.py` and `frontend/dist/` paths; install the wheel in a clean venv and run `batch-review --help`.
