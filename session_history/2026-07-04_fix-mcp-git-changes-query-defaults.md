# Session: Fix get_git_changes / get_git_diff MCP calls hitting FastAPI Query defaults

## Agent harness
- Harness: ZCode CLI
- Version: builtin:zai-coding-plan/GLM-5.2

## Model
- Model: GLM-5.2
- Provider: Z.ai

## Token usage
- Input tokens: ~12,000
- Output tokens: ~1,800
- Total tokens: ~13,800

## Prompt / conversation

### User
Run the test suite of this mcp server and fix broken test.

### Agent
Inspected the repo. There is no pytest/vitest suite; the only test is the MCP
stdio smoke test at `scripts/test_mcp_client.py`. Ran it with
`uv run python scripts/test_mcp_client.py` and found it failed at the
`get_git_changes` call performed after `init_batch_review_session`:

```
HTTPException: 400: Unsupported git compare mode:
annotation=str required=False default='local' alias='mode' json_schema_extra={}
```

Root cause: `backend/api/git_ops.py` defines `git_changes` and `git_diff` as
FastAPI route handlers whose parameters (`mode`, `base`, `head`, `pr`,
`old_path`) default to `Query(...)`/`Query(default=...)` objects. When the MCP
tools in `backend/mcp_tools.py` invoked those handlers as plain Python
functions, the FastAPI defaults were never resolved to real values, so `mode`
held a `Param` object. `mode != "local"` was therefore always truthy and
execution fell through to `_compare_refs`, which rejected the unrecognized
"mode" string.

Fix: pass explicit keyword arguments from the MCP tools so the FastAPI
`Query` defaults are never consulted. The route handlers themselves are
unchanged and still resolve defaults correctly when invoked over HTTP.

Verified by re-running the smoke test: all checks pass, exit code 0.

### User
Yes (proceed to commit).

### Agent
Created this session history file, created branch `fix/mcp-query-defaults`,
and committed the change.

## Files changed
- `backend/mcp_tools.py` — `get_git_changes` now calls `git_changes(mode="local", base=None, head=None, pr=None)` and `get_git_diff` calls `git_diff(path=path, old_path=None, mode="local", base=None, head=None, pr=None)` with explicit keyword arguments so FastAPI `Query` defaults on the route handlers are not consulted when invoked as a plain Python function.

## Reproduction steps
1. Check out the base commit (`5649370` on `main`).
2. Run `uv run python scripts/test_mcp_client.py` and observe the
   `Unsupported git compare mode: ...` failure after
   `init_batch_review_session`.
3. Apply the edit to `backend/mcp_tools.py` (explicit kwargs in both
   `get_git_changes` and `get_git_diff`).
4. Re-run `uv run python scripts/test_mcp_client.py`; all checks pass
   with exit code 0.
