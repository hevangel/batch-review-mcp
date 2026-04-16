# Session: AGENTS.md pre-commit guidance and session_history Git hook

## Agent harness

- Harness: Cursor (agent mode)
- Version: (workspace session)

## Model

- Model: (as configured in Cursor)
- Provider: Cursor

## Token usage

- Input tokens: (approximate / unavailable)
- Output tokens: (approximate / unavailable)
- Total tokens: (approximate / unavailable)

## Prompt / conversation

### User

> add to AGETNS.md before git commit, always read CONTRIBUTING.md and follow the contribution guideline. can you add a hook that make sure a commit must add a new or update an existing session history file

### Agent

- Extended `AGENTS.md` with a **Git commits** section: require reading `CONTRIBUTING.md` before each commit, document `git config core.hooksPath .githooks`, and describe the `pre-commit` policy.
- Added `.githooks/pre-commit`: rejects commits whose staged changes do not add or modify any `session_history/*.md` file except `session_history/TEMPLATE.md`; skips when `.git/MERGE_HEAD` exists (in-progress merge).
- Added this session history file to satisfy the policy for the change itself.

## Files changed

- `AGENTS.md` — Git commits section (CONTRIBUTING + hooks)
- `.githooks/pre-commit` — enforce session history in each commit
- `session_history/2026-04-15_agentsmd-precommit-session-history.md` — this file

## Reproduction steps

1. Check out the base commit before this change.
2. Apply the edits above (AGENTS.md, `.githooks/pre-commit`, and a new session history file).
3. Run `git config core.hooksPath .githooks` in the repo root.
4. Attempt `git commit` without staging a non-template `session_history/*.md` change — the hook should exit non-zero with an error message.
5. Stage a qualifying `session_history/` file and commit — should succeed.
