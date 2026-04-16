# Session: GitHub Actions release workflow on version tags

## Agent harness
- Harness: Cursor (agent mode)
- Version: (workspace session)

## Model
- Model: (per Cursor routing)
- Provider: Cursor

## Token usage
- Input tokens: (approximate) ~6,000
- Output tokens: (approximate) ~2,000
- Total tokens: (approximate) ~8,000

## Prompt / conversation

### User
Add the GitHub workflow to publish and release when a release tag is pushed.

### Agent
Replaced `.github/workflows/release-mcpb.yml` with `.github/workflows/release.yml`: on `push` of tags `v*`, checkout, build frontend, `uv build` (wheel + sdist), `scripts/build_mcpb.py`, `sha256sum dist/*`, `softprops/action-gh-release` with `generate_release_notes` and uploads for `.mcpb`, `.whl`, `.tar.gz`; optional `uv publish` when `secrets.PYPI_API_TOKEN` is set. Updated README registry section to describe the workflow and secret.

## Files changed
- `.github/workflows/release.yml` — new unified release workflow
- `.github/workflows/release-mcpb.yml` — removed (superseded)
- `README.md` — document tag-triggered release and optional PyPI
- `session_history/2026-04-15_github-release-workflow.md` — this file

## Reproduction steps
1. Add `.github/workflows/release.yml` as committed.
2. Push tag `v0.1.0` and confirm Actions creates a release with attached artifacts.
