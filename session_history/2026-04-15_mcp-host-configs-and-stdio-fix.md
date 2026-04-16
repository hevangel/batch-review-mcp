# Session: Repo MCP configs for multiple hosts + stdio reliability

## Agent harness

- Harness: Cursor Agent

## Model

- Not recorded

## Token usage

- Not recorded

## Prompt / conversation

### User

Add repo-level MCP JSON for Cursor CLI (with Playwright), plus configs for GitHub Copilot, Claude Code, Codex CLI, and Gemini CLI; test MCP using the Cursor CLI `-p` flow.

### Agent

Added `.cursor/mcp.json`, `.vscode/mcp.json`, `.mcp.json`, `.codex/config.toml`, `.gemini/settings.json`; fixed `main.py` to call `mcp_instance.run(transport="stdio", show_banner=False)` and `FASTMCP_CHECK_FOR_UPDATES` default so stdio JSON-RPC is not corrupted; used `--root` `.` for Cursor configs because `agent` may not expand `${workspaceFolder}` in args; added `scripts/test_mcp_client.py`; documented in `README.md`.

## Files changed

- `.cursor/mcp.json` — new
- `.vscode/mcp.json` — new
- `.mcp.json` — new
- `.codex/config.toml` — new
- `.gemini/settings.json` — new
- `main.py` — stdio `show_banner=False`, update check default
- `scripts/test_mcp_client.py` — new smoke test
- `README.md` — host config table and verify commands

## Reproduction steps

1. Check out the base commit.
2. Re-apply the file changes above, or re-run the user prompt in Cursor Agent mode.
