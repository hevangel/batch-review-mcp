# Batch Review MCP server

## Basic Standards

- When you change behavior, APIs, MCP tools, or the UI, **update `README.md` (and this file when project rules for agents change) in the same change** so documentation stays accurate.
- This repo uses **uv** for Python package management; always run scripts with `uv run python`
- Use **4 spaces** for indentation (no tabs)
- Use **snake_case** for function and variable names
- Do not call `python -c` with generated code; create a Python script then run it
- Always print progress messages when creating Python scripts

## UI Layout Rules

- **CommentBox** (`frontend/src/components/RightPanel/CommentBox.tsx`): the `@filename:L…` reference link MUST always be the **first element** inside the card, above the textarea. Do not move it to the bottom.

## Git commits

- Before every `git commit`, read [`CONTRIBUTING.md`](CONTRIBUTING.md) and follow its guidelines (AI-only code policy, required `session_history/` file format, build verification, and related rules).
- Enable repo Git hooks after clone (once per clone): `git config core.hooksPath .githooks`  
  The `pre-commit` hook rejects commits that do not **add or modify** at least one Markdown file under `session_history/` other than `session_history/TEMPLATE.md`. Merge commits are skipped so routine merges are not blocked.