# Session: Add screenshot to README

## Agent harness
- Harness: GitHub Copilot Chat (VS Code agent mode)
- Version: copilot-chat-0.43.0

## Model
- Model: Claude Sonnet 4.6
- Provider: Anthropic (via GitHub Copilot)

## Token usage
- Input tokens: ~8,000
- Output tokens: ~3,000
- Total tokens: ~11,000

## Prompt / conversation

### User
I need to add screenshot of my branch review mcp server to README.md, please run it, make some useful mock review comment entry, and take a screenshot, update the README.md. Make sure the center panel is opening the README file

### User (follow-up)
you don't need to start a new instance, just use the mcp server that is already started

### Agent
Used the already-running MCP server at http://127.0.0.1:9000.

1. Opened `README.md` in the UI center panel via `open_file_in_ui`.
2. Added 4 realistic mock review comments via `add_comment`:
   - `@README.md:L1-4` — suggest PyPI/licence shield badges in the header
   - `@README.md:L23-24` — clarify Node.js is not needed for PyPI installs
   - `@README.md:L32-34` — fix placeholder `your-org` clone URL to `hevangel`
   - `@README.md:L53` — suggest documenting `--no-browser` inline with standalone usage
3. Highlighted lines 1-4 to make the right-panel comment visible.
4. Navigated to the app with Playwright and took a screenshot showing all three panels.
5. Saved screenshot to `docs/screenshot.png`.
6. Inserted the image into `README.md` right below the intro paragraph.

## Files changed
- `README.md` — added `![Batch Review UI …](docs/screenshot.png)` after the intro paragraph
- `docs/screenshot.png` — new screenshot of the running UI

## Reproduction steps
1. Check out this commit's parent.
2. Ensure the batch-review MCP server is running (`uv run batch-review --root . --skip-build`).
3. Open VS Code → GitHub Copilot Chat → Agent mode.
4. Paste the prompt above; the agent will use the MCP tools to add comments, take a screenshot via Playwright, and update README.md.
