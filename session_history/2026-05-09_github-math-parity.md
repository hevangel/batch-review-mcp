# Session: Align markdown math delimiters with GitHub

## Agent harness

- Harness: Cursor IDE (Composer coding agent)

## Model

- Model: (session default via Cursor)

## Token usage

- Input tokens: ~25,000 (approx.)
- Output tokens: ~8,500 (approx.)
- Total tokens: ~33,500 (approx.)

## Prompt / conversation

### User

double check the math equation rendering markdown view. make sure it support the github math equation markdown format 100% correct

### Agent

Reviewed GitHub documentation for mathematical expressions and compared to `MarkdownViewer.tsx`. Restored `$…$` inline parsing (`singleDollarTextMath: true`), fixed dollar-backtick normalization to emit `$…$` instead of `$$\n…\n$$` so inline math matches GitHub layout, refreshed README with delimiter notes and KaTeX vs MathJax / HTML caveat, verified `npm run build` in `frontend`.

## Files changed

- `frontend/src/components/CenterPanel/MarkdownViewer.tsx` — GitHub-aligned math delimiter handling
- `README.md` — updated math syntax documentation

## Reproduction steps

1. Check out this repository at the parent commit of this session.
2. Apply the edits described above or rerun the Cursor agent with the user prompt above.
3. Run `npm run build` in `frontend` to verify the UI compiles.
