# Session: Shared toolbar icons — center, file tree, right load/save

## Prompt
User: center panel buttons icon+label like right panel; expand/collapse all + reload same style; right load/save same icon style, no label.

## Follow-up
- Save control uses a **floppy-disk** outline (`IconSaveToDisk`), not arrow-down-tray.
- Expand/collapse icons redrawn for vertical balance in the viewBox; file-tree buttons use a fixed `h-3.5 w-3.5` icon box + `leading-none` / `leading-tight` for alignment with labels.

## Change
- `frontend/src/components/ui/toolbarIcons.tsx` — shared SVGs (`IconRefresh`, `IconPlus`, `IconTrash`, `IconClearSession`, `IconExpandAll`, `IconCollapseAll`, `IconFolderLoad`, `IconSaveToDisk`) + `toolbarIconClass` / `toolbarIconOnlyClass` / button class strings.
- `CodeViewer`, `DiffViewer`, `MarkdownViewer`, `ImageViewer` — reload + add use icons + Reload / Add labels, `aria-label`, shared classes.
- `CenterPanel/index.tsx` — error-state reload matches.
- `FileExplorer.tsx` — expand all / collapse all icon + labels, `aria-label`.
- `RightPanel/index.tsx` — remove duplicate icon defs; import shared icons; load/save icon-only with `aria-label` + `title`; save shows spinning `IconRefresh` while saving.
