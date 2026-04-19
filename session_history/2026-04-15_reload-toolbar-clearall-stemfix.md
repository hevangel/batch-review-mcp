# Session: Reload row layout, Clear all placement, review stem empty fix

## Agent harness
- Harness: Cursor agent
- Version: unavailable

## Model
- Model: unavailable
- Provider: unavailable

## Token usage
- unavailable

## Prompt / conversation

### User
Center panel: put Reload on the same row as Add Comment (right), similar button style; remove the extra top row. Right panel: Clear all below the dropdown. Fix review filename edit: deleting all chars and Enter made the field disappear — empty commit should keep the previous filename.

### Agent
Moved Reload into Code/Diff/Markdown/Image viewer toolbars next to + Add Comment (gray-600 vs blue-700). CenterPanel dropped the shared top bar; loading/error simplified with optional Reload on error. Right header uses a right column: sort + filter, then Clear all. Stem edit uses `stemSnapshotRef`, `commitStemEdit` / `cancelStemEdit`, Escape + blur skip ref to avoid stale double-commit.

## Files changed
- `frontend/src/components/CenterPanel/index.tsx`
- `frontend/src/components/CenterPanel/CodeViewer.tsx`
- `frontend/src/components/CenterPanel/DiffViewer.tsx`
- `frontend/src/components/CenterPanel/MarkdownViewer.tsx`
- `frontend/src/components/CenterPanel/ImageViewer.tsx`
- `frontend/src/components/RightPanel/index.tsx`
- `session_history/2026-04-15_reload-toolbar-clearall-stemfix.md`

## Reproduction steps
1. Open a file: toolbar shows path left, Reload + Add Comment right.
2. Right panel: Clear all sits under the filter dropdown.
3. Click review filename, delete all, Enter — label shows previous name again.
