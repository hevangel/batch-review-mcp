# Session: Add CLI client mode + Claude Code plugin

## Agent harness
- Harness: ZCode (interactive coding agent)
- Version: builtin:zai-coding-plan/GLM-5.2

## Model
- Model: GLM-5.2
- Provider: Z.ai

## Token usage
- Input tokens: ~85,000
- Output tokens: ~32,000
- Total tokens: ~117,000

## Prompt / conversation

### User
is this mcp server comes with CLI and agent skill?

### Agent
Explored the repository and confirmed: the server ships a CLI (`batch-review` console script via `main:cli_main`) with standalone/MCP-stdio modes, and one bundled Cursor skill at `.cursor/skills/session-history-metadata/SKILL.md` (a contributor-workflow helper, not a review-workflow skill).

### User
when it is running in standalone mode, can claude code or codex still interactive with the batch review front end?

### Agent
Investigated `backend/app.py` and `backend/api/reviews.py`. Found that REST endpoints DO broadcast to WebSocket clients (`state.broadcast(WsEvent(...))`), so a CLI/HTTP client automatically keeps the UI in sync. However, the checked-in agent configs (`.mcp.json`, `.codex/config.toml`, etc.) all spawn their own stdio server process rather than attaching to the running standalone server. Recommended pointing agents at `http://localhost:PORT/mcp` instead.

### User
Ok. I want update the batch_review_mcp server to support CLI mode. like how playwright-cli to playwright mcp server. then add the claude marketplace/plugin json to the repo, add the SKILLS.md to let ai agent how to use batch review CLI.

### Agent
Researched the Playwright CLI pattern, Claude Code plugin/marketplace format, and SKILL.md structure. Mapped the full MCP tool + REST API surface. Designed a plan with 6 steps:

1. `backend/cli_client.py` — server discovery + HTTP client + all verbs
2. REST endpoints for UI control (`/api/ui/open`, `/api/ui/highlight`, `/api/ui/jump`) + session init (`/api/session/init`)
3. Backward-compatible CLI dispatch in `main.py`
4. Claude plugin files (`.claude-plugin/plugin.json`, `marketplace.json`, `commands/batch-review.md`)
5. `skills/batch-review/SKILL.md` — review workflow skill
6. Documentation updates (README, AGENTS.md, .gitignore, version bumps)

User confirmed: auto-discover + start/stop verbs (not auto-start), CLI-only plugin (no MCP server entry).

### Agent (implementation)
Created all files, verified end-to-end: `start` → `changes` → `diff` → `add-comment` → `list-comments` → `update-comment` → `open` → `highlight` → `save` → `delete-comment` → `stop`. Verified backward compat with `scripts/test_mcp_client.py`. Verified error handling (no server → JSON error + exit 1).

## Files changed
- `backend/cli_client.py` — new file: CLI client module with server discovery, HTTP client (stdlib urllib), 22 verbs, argparse dispatch
- `backend/api/reviews.py` — added 4 new REST endpoints: `/api/ui/open`, `/api/ui/highlight`, `/api/ui/jump`, `/api/session/init` (mirror MCP-only UI tools, ungated)
- `main.py` — added CLI verb dispatch at top of `cli_main()` (backward-compatible); added port-file writing for server discovery
- `.claude-plugin/plugin.json` — new file: Claude Code plugin manifest (CLI-only, no mcpServers)
- `.claude-plugin/marketplace.json` — new file: marketplace catalog
- `commands/batch-review.md` — new file: `/batch-review` slash command
- `skills/batch-review/SKILL.md` — new file: review workflow skill with verb reference + troubleshooting
- `pyproject.toml` — version bump 1.1.0 → 1.2.0
- `mcpb/manifest.json` — version bump 1.1.0 → 1.2.0
- `server.json` — version bump 1.1.0 → 1.2.0 (SHA will be recomputed by Release workflow)
- `.gitignore` — added `.batch_review/` (runtime discovery files)
- `AGENTS.md` — added CLI client mode and Claude plugin documentation sections
- `README.md` — added CLI client mode section, Claude plugin section, updated features table, CLI flags section, and architecture diagram

## Reproduction steps
1. Check out the base commit: `git checkout 9e57a18`
2. Open ZCode in the batch-review-mcp repo
3. Paste: "I want update the batch_review_mcp server to support CLI mode. like how playwright-cli to playwright mcp server. then add the claude marketplace/plugin json to the repo, add the SKILLS.md to let ai agent how to use batch review CLI."
4. The agent designs and implements the CLI client, REST endpoints, plugin files, SKILL.md, and documentation updates.
5. Verify with: `uv run batch-review start --root . --no-browser` then `uv run batch-review changes` etc.
