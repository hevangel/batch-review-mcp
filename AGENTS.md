# Batch Review MCP server

## Basic Standards

- When you change behavior, APIs, MCP tools, or the UI, **update `README.md` (and this file when project rules for agents change) in the same change** so documentation stays accurate.
- This repo uses **uv** for Python package management; always run scripts with `uv run python`
- Use **4 spaces** for indentation (no tabs)
- Use **snake_case** for function and variable names
- Do not call `python -c` with generated code; create a Python script then run it
- Always print progress messages when creating Python scripts
- When creating `session_history/` files, use the **actual current session date** in the filename (`YYYY-MM-DD`); do not copy a prior date from older session files.
- For Cursor CLI coding agent session history, populate harness version and token usage with `uv run python scripts/session_history_metadata.py ...`; do not write `unavailable` if the repo utility can extract exact values.

## CLI client mode

The `batch-review` command supports two interfaces:

- **Server mode** (legacy flags): `batch-review [--mcp] [--root .] [--port 9000]` — starts the review server + web UI. Backward compatible with all existing MCP host configs (`.mcp.json`, `.cursor/mcp.json`, etc.).
- **CLI client mode** (subcommand verbs): `batch-review <verb> [args]` — token-efficient agent client that talks to a running server over REST. Verbs: `start`, `stop`, `changes`, `diff`, `add-comment`, `list-comments`, `save`, `load`, etc. See [`backend/cli_client.py`](backend/cli_client.py) and [`skills/batch-review/SKILL.md`](skills/batch-review/SKILL.md).

The dispatch rule: if `sys.argv[1]` is a known CLI verb, run the client; otherwise fall through to the legacy server parser. **Never name a CLI verb that collides with a legacy flag** (`--mcp`, `--root`, `--dev`, etc.).

## Claude Code plugin

The repo ships a Claude Code plugin at [`.claude-plugin/`](.claude-plugin/) (CLI-only — no MCP server entry, so agents don't load tool schemas into context). The plugin bundles the [`batch-review`](skills/batch-review/SKILL.md) skill and a [`/batch-review`](commands/batch-review.md) slash command.

## Protocol compatibility

This server speaks the **legacy MCP era** (revision `2025-11-25`, the `initialize` handshake era) — the era every released MCP host uses today. The `2026-07-28` spec (stateless, per-request `_meta`, `server/discover`, new HTTP headers) requires `mcp>=2.0.0`, but `fastmcp` (latest stable 3.x) pins `mcp<2.0`. Dual-era support lands when `fastmcp` 4.x is published to PyPI.

**Do not** hand-roll a custom protocol-compat layer on top of `fastmcp` 3.x — the library owns JSON-RPC dispatch and the transport, so intercepting `_meta`/headers would conflict with its internal handling. The single source of truth for protocol-version status is [`backend/mcp_compat.py`](backend/mcp_compat.py). The upgrade trigger is `PENDING_PROTOCOL_VERSIONS` there; moving `mcp` to `>=2.0.0` flips the server to dual-era.

## UI Layout Rules

- **CommentBox** (`frontend/src/components/RightPanel/CommentBox.tsx`): the `@filename:L…` reference link MUST always be the **first element** inside the card, above the textarea. Do not move it to the bottom.

## Git commits

- Before every `git commit`, read [`CONTRIBUTING.md`](CONTRIBUTING.md) and follow its guidelines (AI-only code policy, required `session_history/` file format, build verification, and related rules).
- Enable repo Git hooks after clone (once per clone): `git config core.hooksPath .githooks`  
  The `pre-commit` hook rejects commits that do not **add or modify** at least one Markdown file under `session_history/` other than `session_history/TEMPLATE.md`. Merge commits are skipped so routine merges are not blocked.