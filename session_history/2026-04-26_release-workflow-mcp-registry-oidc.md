# Session: Add GitHub OIDC MCP registry publishing to the release workflow

## Agent harness
- Harness: Cursor CLI coding agent
- Version: 2026.04.17-479fd04

## Model
- Model: GPT-5.4
- Provider: OpenAI

## Token usage
- Input tokens: unavailable (no saved `agent --print --output-format stream-json` capture was retained for this session)
- Output tokens: unavailable (no saved `agent --print --output-format stream-json` capture was retained for this session)
- Total tokens: unavailable (no saved `agent --print --output-format stream-json` capture was retained for this session)

## Prompt / conversation

### User
tag new release, publish to mcp registry and pypi

### Agent
Prepared `v0.4.4`, ran the Linux MCP registry preflight, pushed the final release metadata, tagged the release, and let the GitHub Release workflow publish the GitHub release assets and PyPI package. The final MCP registry publish still required a local `mcp-publisher login github` device-code confirmation because the saved registry token had expired.

### User
why I have to confirm mcp-publisher so often?  I just confirm it last week

### Agent
Explained that `mcp-publisher` stores a short-lived MCP Registry JWT rather than a durable GitHub login, so local workstation publishing regularly needs re-authentication. Suggested moving registry publication into GitHub Actions using `mcp-publisher login github-oidc`.

### User
yes.

### Agent
Updated the release workflow to install `mcp-publisher`, authenticate to the MCP Registry with GitHub Actions OIDC, and publish `server.json` automatically after the GitHub release assets are uploaded. Updated the README release instructions to document the new CI-based publish path and the manual rerun recovery path for existing tags.

## Files changed
- `.github/workflows/release.yml` — added GitHub Actions OIDC-based MCP Registry publishing steps
- `README.md` — documented that the release workflow now publishes to the MCP Registry automatically
- `session_history/2026-04-26_release-workflow-mcp-registry-oidc.md` — recorded this workflow update session

## Reproduction steps
1. Check out the base commit: `git checkout 59a1ca8`
2. Open Cursor in `B:/batch_review_mcp`
3. Use the Cursor CLI coding agent with model `GPT-5.4`
4. Paste the prompts from the "Prompt / conversation" section above
5. Ask the agent to move MCP Registry publication from local `mcp-publisher login github` to GitHub Actions OIDC in the existing release workflow
6. Push the workflow change to `main`
7. Rerun the `Release` workflow manually with `release_tag` set to `v0.4.4` so the existing release picks up the new registry publishing step
