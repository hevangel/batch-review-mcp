# Session: Full-width divider above Clear all

## Prompt
User: on the right panel, move the horizontal divider above the clear all button.

## Change
- `frontend/src/components/RightPanel/index.tsx` — Header is two rows: (1) title + sort/filter; (2) full-width `border-t` row with Clear all right-aligned. Removes the narrow-column-only divider.
