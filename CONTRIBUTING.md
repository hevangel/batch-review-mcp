# Contributing to Batch Review

Thank you for your interest in contributing. This project has an unconventional but intentional policy: **all code contributions must be written by an AI coding agent.** Human-authored code is not accepted.

This ensures every change is reproducible, auditable, and transparent about its origins.

---

## The AI-only code policy

Human reviewers and maintainers are welcome — for architecture decisions, prompt engineering, issue triage, and reviewing AI output. But the code that lands in `main` must come from an AI agent working from a prompt.

**Why?**
- Every change can be reproduced by replaying the session prompt against the same model.
- The history of *how* something was built is as important as *what* was built.
- It creates an auditable trail for security, correctness, and design decisions.

---

## Session history requirement

Every PR **must** include a session history file in the `session_history/` folder. This file records the full context needed to reproduce the PR from scratch.

### File location and naming

```
session_history/<YYYY-MM-DD>_<short-slug>.md
```

Example: `session_history/2026-04-15_add-markdown-export.md`

### Required fields

```markdown
# Session: <Short description of the change>

## Agent harness
<!-- The tool / IDE / product used to run the AI, e.g.: -->
- Harness: GitHub Copilot Chat (VS Code agent mode)
- Version: copilot-chat-0.43.0

## Model
- Model: Claude Sonnet 4.6
- Provider: Anthropic (via GitHub Copilot)

## Token usage
- Input tokens: ~12,400
- Output tokens: ~8,200
- Total tokens: ~20,600
<!-- Approximate is fine if exact counts are unavailable. -->

## Prompt / conversation
<!-- Paste the full conversation or the key prompts that drove the changes.
     If the conversation is too long, paste the initial user prompt + any
     pivotal clarifying turns. Attach a full export if available. -->

### User
<your initial request here>

### Agent
<agent response / summary of what it did>

<!-- Continue for all meaningful turns -->

## Files changed
<!-- List every file the agent created or modified -->
- `backend/state.py` — added `save_to_markdown()` method
- `frontend/src/api.ts` — updated `saveComments()` return type

## Reproduction steps
<!-- How someone can reproduce this exact PR from scratch -->
1. Check out the base commit: `git checkout <base-sha>`
2. Open VS Code → GitHub Copilot Chat → Agent mode
3. Paste the prompt from the "Prompt / conversation" section above
4. The agent should produce identical (or functionally equivalent) changes.
```

A template is provided at [`session_history/TEMPLATE.md`](session_history/TEMPLATE.md).

---

## PR workflow

### 1. Open an issue first (for non-trivial changes)

Describe the problem or feature. The issue becomes the brief you give the AI agent.

### 2. Create a branch

```bash
git checkout -b feat/your-feature-name
```

### 3. Run your AI session

Use your preferred AI coding agent (GitHub Copilot, Cursor, Claude Code, Aider, etc.) to implement the change. Keep a record of the conversation.

### 4. Add your session history file

Create `session_history/YYYY-MM-DD_your-slug.md` following the template above.

### 5. Verify the build

```bash
uv sync
cd frontend && npm run build && cd ..
uv run batch-review --root . --skip-build --no-browser &
# run any manual checks, then kill the server
```

### 6. Open a PR

- Title: concise description of the change
- Body: link to the issue + brief summary
- The PR **will be rejected** if `session_history/` does not contain a file for this PR

### 7. Review

Maintainers will:
- Read the session history to understand the agent's reasoning
- Attempt to spot-check reproducibility if the change touches security-sensitive areas
- Merge or request changes via PR comments (which you feed back to the agent for a follow-up session — add that turn to the session history file)

---

## Session history template

A starter template lives at [`session_history/TEMPLATE.md`](session_history/TEMPLATE.md). Copy it and fill in the fields.

---

## Code style

The agent is expected to follow the rules in [`AGENTS.md`](AGENTS.md). Key points:

- Python: 4-space indent, snake_case, `uv run python` for scripts
- TypeScript: strict mode, no `any` unless documented
- No secrets, credentials, or personal data in any file
- No documentation markdown files unless explicitly requested

---

## Security

If you discover a security vulnerability, do **not** open a public issue. Email the maintainers directly (see the repository contact). The AI-only policy still applies — once confirmed, the fix should be authored by an AI agent with a full session history.

---

## License

By submitting a PR you agree that your contribution (including the AI-generated code and your session history) will be licensed under the [MIT License](LICENSE).
