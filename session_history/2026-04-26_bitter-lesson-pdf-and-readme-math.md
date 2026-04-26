# Session: Replace the docs PDF and add a README math example

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
remove the dragon porfolio pdf from docs, download the bitter lesson pdf instead and commit it with this repo.   also addd a math equation to the README.md to show that the branch review tool support math equation like github

### Agent
Checked the repo state, confirmed the untracked PDF in `docs/` was the file the user wanted removed, located a direct PDF source for *The Bitter Lesson*, and reviewed the existing README section that already documents GitHub-style math support.

### Agent
Deleted `docs/Artemis_AllegoryHawkSerpent_January2020.pdf`, downloaded `docs/The_Bitter_Lesson_March2019.pdf`, and added a short README example that renders both inline GitHub-style math and a displayed equation so the support is visible in the project documentation.

## Files changed
- `README.md` — added a visible GitHub-style math example with inline and block equations
- `docs/Artemis_AllegoryHawkSerpent_January2020.pdf` — removed the unrelated PDF from the docs folder
- `docs/The_Bitter_Lesson_March2019.pdf` — added *The Bitter Lesson* PDF to the docs folder
- `session_history/2026-04-26_bitter-lesson-pdf-and-readme-math.md` — recorded this AI session for reproducibility

## Reproduction steps
1. Check out the base commit: `git checkout 5dd0e59`
2. Open Cursor in `B:/batch_review_mcp`
3. Use the Cursor CLI coding agent with model `GPT-5.4`
4. Paste the prompt from the "Prompt / conversation" section above
5. Ask the agent to replace the docs PDF with *The Bitter Lesson*, add a visible GitHub-style math example to `README.md`, and commit the result
