# Batch Review

A collaborative code and markdown review tool that bridges human reviewers and AI agents. Both can browse files, inspect git diffs, leave structured comments, and save a final review report — all from the same UI, in real time.

---

## Features

| Feature | Description |
|---|---|
| **3-panel review UI** | File explorer + git changes on the left, viewer in the center, comment thread on the right |
| **Markdown rendering** | `.md` files are fully rendered; highlight any paragraph to add a comment |
| **Syntax highlighting** | All common languages via Monaco Editor (Python, TypeScript, Go, Rust, etc.) |
| **Inline git diff** | Click any changed file to view an inline red/green unified diff |
| **Structured comments** | Each comment captures `@filename:L10-15` line references automatically |
| **AI collaboration** | MCP server exposes many tools so AI agents can review alongside humans — UI updates live, with on-screen notices for agent-driven comment changes |
| **Dual output** | Saves review as both **JSON** (machine-readable) and **Markdown** (human-readable) |
| **Resume session** | On startup, if `<output-dir>/<output>.json` already exists, comments are loaded automatically |
| **Cross-platform** | Runs on Windows and Linux |

---

## Requirements

- Python ≥ 3.11 with [uv](https://docs.astral.sh/uv/)
- Node.js ≥ 18 (for the one-time frontend build)

---

## Installation

```bash
git clone https://github.com/your-org/batch-review-mcp
cd batch-review-mcp
uv sync
```

The first run will automatically build the React frontend if `frontend/dist/` does not exist (requires Node.js + npm on `PATH`).

---

## Usage

### Standalone mode (browser opens by default)

```bash
# Review the current directory
uv run batch-review

# Review a specific git repository
uv run batch-review --root /path/to/your/repo

# Custom host / port
uv run batch-review --root /path/to/repo --host 0.0.0.0 --port 9100

# Specify output filenames
uv run batch-review --root /path/to/repo --output review --output-dir /tmp/reviews
# → saves /tmp/reviews/review.json and /tmp/reviews/review.md
```

The server auto-selects a free port in the 9000–9999 range if the default port is already in use.

### MCP stdio mode (Claude Desktop / Cursor / any MCP client; browser opens by default)

```bash
uv run batch-review --mcp --root /path/to/repo
```

The HTTP server starts in a background thread (so the browser UI remains accessible), your default browser opens to the app URL (same as standalone mode; use `--no-browser` to skip), and the MCP stdio transport runs in the main thread.

**Claude Desktop config** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "batch-review": {
      "command": "uv",
      "args": ["run", "batch-review", "--mcp", "--root", "/path/to/repo"]
    }
  }
}
```

### Official MCP registry

This project includes a root-level [`server.json`](./server.json) for the [Model Context Protocol registry](https://registry.modelcontextprotocol.io/) (preview). The registry entry points at an **MCP Bundle** (`.mcpb`) attached to a **GitHub release** (not PyPI).

1. Tag and create a GitHub release **`v0.1.0`** (or your version) and attach **`batch-review-mcp-0.1.0.mcpb`** from `dist/` (build it with `uv run python scripts/build_mcpb.py` after `npm run build` in `frontend/`).
2. If the bundle bytes change, update **`fileSha256`** in `server.json` to match (`uv run python scripts/build_mcpb.py` prints the value).
3. Install [`mcp-publisher`](https://github.com/modelcontextprotocol/registry/releases), run **`mcp-publisher login github`** (as `hevangel`), then from this repository run **`mcp-publisher publish`**.

### CLI flags

| Flag | Default | Description |
|---|---|---|
| `--root PATH` | current directory | Git repository to review |
| `--host HOST` | `127.0.0.1` | Bind address |
| `--port PORT` | `9000` | Preferred port (auto-increments if busy) |
| `--output NAME` | `review_comments` | Base filename for saved output (no extension) |
| `--output-dir DIR` | repo root | Directory to write output files |
| `--mcp` | off | Enable MCP stdio transport |
| `--no-browser` | false (omit) | **Normal behavior** (flag omitted): browser opens automatically ~1.2s after the server is ready in standalone, `--dev`, and `--mcp`. Pass `--no-browser` to disable. |
| `--skip-build` | off | Skip the npm build step |

---

## UI Walkthrough

### Left panel — two tabs

**Files tab** — recursive directory tree. Click a file to open it in the center panel.

**Git tab** — lists files changed relative to HEAD with status badges:
- 🟡 `M` modified
- 🟢 `A` added
- 🔴 `D` deleted
- ⚪ `U` untracked

Click a changed file to open it in inline diff mode.

### Center panel

- **Markdown files** — fully rendered. Select any text with the mouse and click **+ Add Comment** to create a comment anchored to those line numbers.
- **Code files** — Monaco Editor with syntax highlighting. Select lines and click **+ Add Comment** in the toolbar.
- **Diff view** — Monaco DiffEditor showing original (HEAD) vs working tree inline (red = removed, green = added). Switch back to normal view via the Git tab or by clicking the file in the Files tab.

### Right panel

Each comment shows:
- `@filename:L10-15` reference — click to jump to that location in the center panel
- A text area for your review notes (auto-saves on blur)
- A delete button

The **💾 Save Review** button saves all comments to:
- `<output-dir>/<output>.json` — machine-readable JSON array
- `<output-dir>/<output>.md` — human-readable Markdown report grouped by file

When the server starts, if that JSON file already exists it is **loaded into the session** so you can continue a saved review (invalid files are skipped with a log warning).

---

## MCP Tools

AI agents connect via `http://localhost:<port>/mcp` (HTTP transport) or stdio (`--mcp` flag).

### Repo-local MCP host configuration

This repository includes checked-in defaults so common agents can use **Batch Review** and **Playwright** together:

| Product | Config file | Format |
| --- | --- | --- |
| **Cursor** (editor and `agent` CLI) | [`.cursor/mcp.json`](.cursor/mcp.json) | `mcpServers` with `"type": "stdio"` |
| **VS Code / GitHub Copilot** | [`.vscode/mcp.json`](.vscode/mcp.json) | `servers` with `"type": "stdio"` ([reference](https://code.visualstudio.com/docs/copilot/reference/mcp-configuration)) |
| **Claude Code** | [`.mcp.json`](.mcp.json) | Project `mcpServers` (stdio) |
| **OpenAI Codex CLI** | [`.codex/config.toml`](.codex/config.toml) | `[mcp_servers.<name>]` stdio blocks (loaded for trusted projects) |
| **Gemini CLI** | [`.gemini/settings.json`](.gemini/settings.json) | Top-level `mcpServers` ([guide](https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html)) |

All definitions run `uv run batch-review --mcp --root . --skip-build` so the review root is the **workspace directory** hosts use as the server cwd. Cursor’s `agent` CLI does not always expand `${workspaceFolder}` inside `args`, so these configs use `"."` for `--root` (VS Code may still use `${workspaceFolder}` in `.vscode/mcp.json`, which that host expands).

### Verifying stdio MCP

```bash
# Smoke test with the official Python MCP client
uv run python scripts/test_mcp_client.py

# Cursor Agent CLI (after install: https://cursor.com/docs/cli )
cd /path/to/batch_review_mcp
agent mcp enable batch-review
agent mcp list-tools batch-review
agent --approve-mcps -p "Your prompt that may call MCP tools"
```

| Tool | Description |
|---|---|
| `list_directory(path)` | List files / directories (tree) |
| `read_file(path)` | Read file content as plain text |
| `get_file_content(path)` | Read file as structured data (`content`, `line_count`, `language`, `path`) — matches the REST `/api/file-content` response |
| `get_git_changes()` | List changed files vs HEAD |
| `get_git_diff(path)` | Unified diff + original/modified content |
| `open_file_in_ui(path, mode)` | Open a file in the browser center panel (`view` or `diff`) |
| `close_file_in_ui()` | Clear the center panel |
| `highlight_in_ui(path, line_start, line_end)` | Open file and highlight a 1-based line range |
| `jump_to_comment_in_ui(comment_id)` | Same as clicking a comment’s `@file:L…` link: open file and highlight that anchor |
| `set_left_panel_tab(tab)` | Switch the left sidebar to `files` or `git` |
| `add_comment(...)` | Add a review comment; shows a short notice in the UI |
| `update_comment(comment_id, text)` | Edit comment body; UI notice |
| `delete_comment(id)` | Delete a comment; UI notice |
| `list_comments()` | List all in-memory comments |
| `get_config()` | Return `output_stem`, `output_dir`, and `web_ui_url` (when the server has bound) |
| `get_review_web_url()` | Return `web_ui`, `websocket`, and `mcp_http` URLs for the running app |
| *(resource)* | MCP resource URI **`batch-review://server/urls`** — same URL JSON as `get_review_web_url` (`resources/read`) |
| `list_review_files()` | List stems of `*.json` reviews in `output_dir` |
| `load_review_by_stem(stem)` | Replace comments from `{stem}.json`; UI notice |
| `save_comments(output_stem?, output_dir?)` | Save JSON + Markdown report, returns paths |
| `refresh_file_tree()` | Ask browsers to reload the file tree |

Comment **add**, **update**, **delete**, and **load_review_by_stem** also push a dismissible toast at the bottom of the right panel (similar styling to the post-save path hints).

---

## Output formats

### JSON (`review_comments.json`)

```json
[
  {
    "id": "4c66b5fc-...",
    "file_path": "src/auth.py",
    "line_start": 42,
    "line_end": 55,
    "reference": "@src/auth.py:L42-55",
    "text": "Token is never validated — add expiry check.",
    "created_at": "2026-04-15T10:00:00+00:00"
  }
]
```

### Markdown (`review_comments.md`)

```markdown
# Code Review

_Generated: 2026-04-15 10:00 UTC — 3 comment(s)_

---

## src/auth.py

### `@src/auth.py:L42-55`
> Token is never validated — add expiry check.

---
```

---

## Development

```bash
# Backend only (no frontend build needed)
uv run batch-review --root . --skip-build --no-browser

# Frontend dev server (proxies API to port 9000)
cd frontend && npm run dev

# Full production build
cd frontend && npm run build
```

---

## License

[MIT](LICENSE)
