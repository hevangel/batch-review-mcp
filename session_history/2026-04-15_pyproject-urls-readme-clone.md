# Session: PyPI project URLs and README clone URL

## Agent harness
- Harness: Cursor (agent mode)

## Model
- Model: (per Cursor routing)
- Provider: Cursor

## Token usage
- (approximate) ~2,000 input / ~600 output

## Prompt / conversation

### User
Add urls. Also change README ain't.

### Agent
Added `[project.urls]` (Homepage, Repository, Issues) to `pyproject.toml` for PyPI project links. Replaced README `git clone` placeholder `your-org` with `hevangel` and `.git` suffix. No literal "ain't" in README.

## Files changed
- `pyproject.toml` — `[project.urls]`
- `README.md` — clone URL
- `.gitignore` — ignore `webui.pen` (accidentally staged once; removed from git index)
- `session_history/2026-04-15_pyproject-urls-readme-clone.md` — this file

## Reproduction steps
1. Add `[project.urls]` with GitHub URLs.
2. Update README clone command to the real repository URL.
