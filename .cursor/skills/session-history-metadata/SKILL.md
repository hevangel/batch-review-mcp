---
name: session-history-metadata
description: Extract Cursor CLI coding agent harness version and exact token usage for session_history entries. Use when preparing session_history files, filling Agent harness or Token usage sections, or when the user asks how to record version and tokens accurately.
---
# Session History Metadata

## Use This Skill

Use this skill when you need accurate `session_history/` metadata for a Cursor CLI coding agent run.

Prefer exact token counts from a saved `agent --print --output-format stream-json` log or a terminal capture containing that JSON output. The repo utility script also calls `agent about --format json` to get the CLI version.

## Exact Metadata Workflow

1. Capture or locate a saved Cursor CLI stream log.

   Example capture:

   ```bash
   agent --print --output-format stream-json --trust "Your prompt here" > tmp-agent-stream.jsonl
   ```

   You can also point the utility at a terminal capture file that contains the same JSON lines.

2. Run the repo utility:

   ```bash
   uv run python scripts/session_history_metadata.py --stream-json tmp-agent-stream.jsonl --format markdown --require-usage
   ```

3. Paste the emitted markdown block into the `## Agent harness`, `## Model`, and `## Token usage` sections of your `session_history/` file.

## Notes

- Default harness label: `Cursor CLI coding agent`
- Exact token usage requires a `result.usage` block from Cursor CLI `stream-json` output.
- If you do not have a saved stream log, you can still get the harness version with:

  ```bash
  agent about --format json
  ```

- Raw Cursor transcript exports under `agent-transcripts/` do not currently provide exact token usage, so do not treat them as an exact source for those numbers.
- Do not invent token numbers. If the current harness/workflow does not expose them yet, add or update a repo-local utility/skill rather than writing placeholders as if they were exact.
