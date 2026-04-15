# Batch Review MCP server

## Basic Standards

- This repo uses **uv** for Python package management; always run scripts with `uv run python`
- Use **4 spaces** for indentation (no tabs)
- Use **snake_case** for function and variable names
- Do not call `python -c` with generated code; create a Python script then run it
- Always print progress messages when creating Python scripts

## UI Layout Rules

- **CommentBox** (`frontend/src/components/RightPanel/CommentBox.tsx`): the `@filename:L…` reference link MUST always be the **first element** inside the card, above the textarea. Do not move it to the bottom.