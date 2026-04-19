# Session: Fix false outdated + stronger outdated UI

## Prompt
User: strikethrough not obvious; stale checker wrong (e.g. LICENSE.md unchanged still struck).

## Cause
Equality compared full joined lines to ``highlighted_text``, but Monaco stores only the **selected columns** for partial-line selections while ``line_start``/``line_end`` span whole lines — so unchanged files often failed the strict string compare.

## Change
- `backend/comment_staleness.py` — treat as fresh if highlight equals block, highlight empty (unverifiable), highlight is substring of full-line block, or per-line internal-whitespace-normalized strings match.
- `frontend/.../CommentBox.tsx` — rose banner, ring, thicker rose strikethrough on ref + body.

## Files
- `backend/comment_staleness.py`
- `frontend/src/components/RightPanel/CommentBox.tsx`
- `session_history/2026-04-15_staleness-partial-line-strike-ui.md`
