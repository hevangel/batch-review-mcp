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
| **AI collaboration** | MCP server exposes 10 tools so AI agents can review alongside humans — UI updates live |
| **Dual output** | Saves review as both **JSON** (machine-readable) and **Markdown** (human-readable) |
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

### Standalone mode (opens browser)

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

### MCP stdio mode (Claude Desktop / Cursor / any MCP client)

```bash
uv run batch-review --mcp --root /path/to/repo
```

The HTTP server starts in a background thread (so the browser UI remains accessible) while the MCP stdio transport runs in the main thread.

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

### CLI flags

| Flag | Default | Description |
|---|---|---|
| `--root PATH` | current directory | Git repository to review |
| `--host HOST` | `127.0.0.1` | Bind address |
| `--port PORT` | `9000` | Preferred port (auto-increments if busy) |
| `--output NAME` | `review_comments` | Base filename for saved output (no extension) |
| `--output-dir DIR` | repo root | Directory to write output files |
| `--mcp` | off | Enable MCP stdio transport |
| `--no-browser` | off | Don't open the browser automatically |
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

---

## MCP Tools

AI agents connect via `http://localhost:<port>/mcp` (HTTP transport) or stdio (`--mcp` flag).

| Tool | Description |
|---|---|
| `list_directory(path)` | List files / directories |
| `read_file(path)` | Read file content |
| `get_git_changes()` | List changed files vs HEAD |
| `get_git_diff(path)` | Unified diff + original/modified content |
| `open_file_in_ui(path, mode)` | Open a file in the browser (live update) |
| `highlight_in_ui(path, line_start, line_end)` | Scroll & highlight a range (live update) |
| `add_comment(file_path, line_start, line_end, text)` | Add a review comment (live update) |
| `list_comments()` | List all current comments |
| `delete_comment(id)` | Delete a comment (live update) |
| `save_comments(output_path?)` | Save JSON + Markdown report, returns file paths |

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
