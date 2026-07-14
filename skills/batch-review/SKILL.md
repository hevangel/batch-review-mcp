---
name: batch-review
description: Collaborative code review using the batch-review CLI. Use whenever the user asks to review code, review a PR, review changes/diffs, leave code review comments, batch-review files, inspect git changes, or do a structured code walkthrough — even if they don't explicitly say "batch-review". Drives a shared web UI where human reviewers and the agent see each other's comments in real time.
---

# Batch Review CLI

A token-efficient command-line client for collaborative code review. Each verb is one process invocation that emits a single JSON document to stdout. The CLI talks to a running Batch Review server over REST; every comment and highlight also appears in the human reviewer's browser UI in real time.

## When to use

Use this skill for any code review task: reviewing a git diff, a pull request, working-tree changes, or doing a structured walkthrough of changed files. Prefer it over reading files and writing prose comments manually, because the comments are anchored to line ranges, persisted to JSON + Markdown, and shared live with human reviewers.

## Prerequisites

The `batch-review` command must be available. Install it:

```bash
pip install batch-review-mcp
# or
uv tool install batch-review-mcp
```

Verify: `batch-review changes --help` should print usage.

## Output contract

Every verb prints **one JSON document to stdout** and exits 0 on success. On error, it prints `{"error": "...", "hint": "..."}` and exits non-zero. Parse stdout as JSON; ignore stderr (progress messages only).

## Default workflow

Follow these steps for a typical review session:

1. **Start the server** (only once per session):
   ```bash
   batch-review start --root .
   ```
   Output: `{"web_url": "http://127.0.0.1:9000", "pid": 12345, "port": 9000}`
   The browser opens automatically to the review UI (use `--no-browser` to skip).

2. **List changed files**:
   ```bash
   batch-review changes
   ```
   Output: a JSON array of changes: `[{"path": "main.py", "status": "M", "base_label": "Original (HEAD)", "head_label": "Modified (working tree)"}, ...]`
   Status codes: `M` modified, `A` added, `D` deleted, `R` renamed, `?` untracked.

3. **Inspect each diff** for files worth reviewing:
   ```bash
   batch-review diff main.py
   ```
   Output: `{"path": "main.py", "diff": "--- a/...\n+++ b/...", "original": "...", "modified": "...", ...}`

4. **Read extra context** when the diff isn't enough:
   ```bash
   batch-review file src/utils.py
   ```
   Output: `{"content": "...", "line_count": 42, "language": "python", "path": "src/utils.py"}`

5. **Add comments** anchored to line ranges (1-based, inclusive):
   ```bash
   batch-review add-comment main.py 10 15 "This null check is redundant — bar() never returns None."
   ```
   Output: the created Comment object with `id`, `reference` (e.g. `@main.py:L10-15`), `created_at`, etc. The comment appears instantly in the reviewer's browser UI.

6. **Save the review** when done:
   ```bash
   batch-review save
   ```
   Output: `{"json_path": "/abs/path/review_comments.json", "md_path": "/abs/path/review_comments.md", "comments": [...]}`

7. **Stop the server** at the end of the session:
   ```bash
   batch-review stop
   ```

## Verb reference

All verbs accept `--root PATH` (default: current directory) to set the repository root.

| Verb | Args | Description |
|---|---|---|
| `start` | `[--port N] [--no-browser]` | Start the server in the background; writes `.batch_review/server.json` |
| `stop` | — | Stop the running server and clean up the port file |
| `config` | — | Server config: output stem, output dir, web UI URL, MCP session |
| `url` | — | Connection URLs: web UI, WebSocket, MCP HTTP endpoint |
| `changes` | `[--mode local\|commit\|pr] [--base REF] [--head REF] [--pr N]` | List changed files |
| `diff` | `<path> [--mode ...]` | Unified diff + original/modified content for a file |
| `ls` | `[path] [--depth N]` | List files/directories (lazy tree) |
| `file` | `<path>` | Read a file's content + line count + language |
| `add-comment` | `<path> <line-start> <line-end> [text] [--highlighted TEXT]` | Add a comment anchored to a line range |
| `list-comments` | — | List all comments (alias: `comments`) |
| `update-comment` | `<id> <text>` | Edit a comment's text |
| `delete-comment` | `<id>` | Delete one comment |
| `clear` | — | Delete all comments |
| `delete-outdated` | — | Delete comments whose source text has changed |
| `recompute-stale` | — | Recheck all comments against current source; update `outdated` flags |
| `save` | `[--stem NAME] [--dir DIR]` | Save to JSON + Markdown |
| `load` | `<stem>` | Load a previously saved review by stem |
| `list-reviews` | — | List saved review stems (alias: `reviews`) |
| `open` | `<path> [--mode view\|diff]` | Open a file in the browser UI center panel |
| `highlight` | `<path> <line-start> <line-end>` | Highlight a line range in the browser UI |
| `jump` | `<comment-id>` | Jump to a comment's location in the UI |
| `init-session` | `[--agent NAME] [--model NAME] [--version VER]` | Register this client with the server (shows in UI footer) |

## Tool notes

- **Server discovery**: verbs auto-discover a running server via the `BATCH_REVIEW_WEB_URL` env var, then `.batch_review/server.json`, then probing ports 9000–9999. If no server is found, you get a JSON error with a hint to run `start`.
- **Line numbers** are always 1-based and inclusive (`L10-15` covers lines 10 through 15).
- **`add-comment`** accepts optional `--highlighted TEXT` to store the verbatim source text being commented on. This lets the UI detect when a comment goes stale (the source changed).
- **Comment IDs** are UUIDs. Capture the `id` field from `add-comment` output if you need to update or delete that comment later.
- **`--mode commit`** compares a base ref to HEAD; `--mode pr` compares against a GitHub PR head. Both need `--base` or `--pr` respectively. Default is `local` (working tree vs HEAD).
- The CLI **never loads tool schemas into your context** — each verb is a standalone process. This is why it's more token-efficient than the MCP server equivalent.
- Multiple agents and humans can review simultaneously — all see each other's comments live via WebSocket.

## Comment JSON shape

Every comment object has these fields:

```json
{
    "id": "a1b2c3d4-...",
    "file_path": "main.py",
    "line_start": 10,
    "line_end": 15,
    "reference": "@main.py:L10-15",
    "text": "This null check is redundant.",
    "highlighted_text": "if foo is not None:",
    "created_at": "2026-07-13T12:00:00+00:00",
    "outdated": false
}
```

## Troubleshooting

| Error | Fix |
|---|---|
| `{"error": "No Batch Review server found."}` | Run `batch-review start --root .` first |
| `{"error": "Cannot connect to ..."}` | Server died — restart with `batch-review start` |
| `{"error": "HTTP 404 ...", "detail": "Comment ... not found"}` | The comment ID was wrong or already deleted; run `batch-review list-comments` to see current IDs |
| `{"error": "Path ... escapes the repository root."}` | Use a path relative to `--root`, not an absolute path outside the repo |
| Server already running on a different port | The CLI auto-discovers it; or run `batch-review stop` then `start` |
| Port file stale after a crash | Delete `<repo>/.batch_review/server.json` and run `start` again |
