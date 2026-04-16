# Session: Trim MCP tool surface for review-first local use

## Agent harness
- Harness: Cursor CLI coding agent
- Version: unavailable in session metadata

## Model
- Model: GPT-5.4
- Provider: OpenAI

## Token usage
- Input tokens: unavailable in harness
- Output tokens: unavailable in harness
- Total tokens: unavailable in harness

## Prompt / conversation

### User
just read the readme of this repo, so you know what this repo do. then I want to chat with you to brainstorm some ideas

### Agent
Read `README.md` and summarized Batch Review as a local collaborative code and markdown review tool with a shared UI, git-aware review flow, and MCP support for AI agents.

### User
right now the mcp server only support stdio mode, should I make it support http mode?

### Agent
Reviewed the implementation and explained that the app already mounts the MCP ASGI app at `/mcp`, but stdio is the primary transport exposed in docs and registry metadata. Recommended staying local-first unless there is a concrete remote consumer such as CI or shared hosted review sessions.

### User
think about the use case, what is the use case that user would use it remote?

### Agent
Outlined realistic remote use cases including CI review bots, cloud dev environments, and shared team review workspaces, then compared a local-first tool against a shared review service.

### User
ok.. I will stay with local first for now. since this is a local first mcp server, does it even make sense to have the read file tools and git tools?

### Agent
Recommended keeping git review tools because they define review scope and diff context, while reducing generic filesystem-style tools. Classified the existing MCP surface into core review tools, convenience tools, and tools worth removing.

### User
remove read_file.

### Agent
Removed the generic `read_file` MCP tool from `backend/mcp_tools.py`, updated `README.md`, and verified the server still enumerated tools correctly with `uv run python scripts/test_mcp_client.py`.

### User
yes.

### Agent
Tightened the MCP instructions and README wording so the server presents itself as review-first, with minimal browsing helpers rather than a general-purpose filesystem API.

### User
ok... continue clean up the mcp tools

### Agent
Removed additional low-value UI convenience tools: `close_file_in_ui`, `set_left_panel_tab`, and `refresh_file_tree`. Updated `README.md`, fixed the stale comment in `frontend/src/components/LeftPanel/index.tsx`, and reran the MCP smoke test.

### User
good enought, commit and push

### Agent
Read `CONTRIBUTING.md`, performed the required verification steps, added this session history file, and prepared a focused commit containing only the MCP cleanup changes.

### Agent
While creating the commit on Windows, found that `.githooks/pre-commit` used CRLF line endings, which made Git fail to execute the `#!/bin/sh` hook. Normalized the hook to LF and retried the commit flow.

### User
2 and 3. also add a gitattributes file

### Agent
Investigated the repo-wide line-ending behavior, confirmed the large post-commit diff was CRLF/LF churn caused by mixing PowerShell and Git Bash on Windows, then rewrote the unpushed commit cleanly and added `.gitattributes` to keep future text checkouts normalized to LF.

## Files changed
- `backend/mcp_tools.py` — removed generic and low-value MCP tools, and rewrote tool instructions to emphasize a review-first workflow
- `README.md` — updated the documented MCP tool list and clarified that the MCP surface is review-first
- `frontend/src/components/LeftPanel/index.tsx` — removed a stale comment referencing a deleted MCP tool
- `.gitattributes` — enforce LF text normalization to avoid cross-shell line-ending churn on Windows
- `.githooks/pre-commit` — normalized the hook for Windows-compatible execution and clarified the LF-only requirement
- `session_history/2026-04-15_trim-mcp-tool-surface.md` — recorded the session context required to reproduce this change

## Reproduction steps
1. Check out the base commit: `git checkout 244968615d2ffe3b407ac1d6f87af60ae394a853`
2. Open Cursor in `B:/batch_review_mcp`
3. Use the Cursor CLI coding agent with model `GPT-5.4`
4. Paste the prompts from the "Prompt / conversation" section above
5. Ask the agent to keep the project local-first, remove the generic `read_file` MCP tool, and continue trimming low-value MCP UI convenience tools while updating `README.md`
6. Add a root `.gitattributes` file with LF normalization for text files before committing from Windows
7. If needed, normalize `.githooks/pre-commit` to LF line endings so Git can execute the shell hook
8. Run verification: `uv sync`, `cd frontend && npm run build`, `uv run python scripts/test_mcp_client.py`, and `uv run batch-review --root . --skip-build --no-browser`
