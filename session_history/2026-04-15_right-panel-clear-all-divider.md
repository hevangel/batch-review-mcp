# Session: Divider above Clear all (right panel)

## Prompt
User: on the right panel, move the divider above the clear all button.

## Change
- `frontend/src/components/RightPanel/index.tsx` — wrap Clear all in `self-stretch border-t border-gray-700 pt-1.5 flex justify-end` so a horizontal rule sits above the button under the filter row.
