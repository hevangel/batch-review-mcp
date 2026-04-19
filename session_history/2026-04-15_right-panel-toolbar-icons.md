# Session: Right panel toolbar — icons + labels + a11y

## Prompt
User: implement streamlined buttons (reload, delete outdated, clear all) with icons; use aria-label, title, short text, distinct icons.

## Change
- `frontend/src/components/RightPanel/index.tsx` — `IconRefresh`, `IconTrash`, `IconClearSession` (SVG, `aria-hidden`); buttons `inline-flex` with icon + short label; `aria-label` + `title`; `flex-wrap` on narrow width.
