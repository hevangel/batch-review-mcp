import { useEffect, useRef, useCallback } from "react";
import { DiffEditor } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import type { DiffResponse } from "../../types";
import { useStore } from "../../store";
import { createComment } from "../../api";
import { IconPlus, IconRefresh, toolbarBtnNeutral, toolbarBtnPrimary, toolbarIconClass } from "../ui/toolbarIcons";

interface DiffViewerProps {
  diff: DiffResponse;
  language: string;
  filePath: string;
}

function applyDiffModifiedHighlight(
  diffEd: MonacoEditor.IStandaloneDiffEditor,
  filePath: string,
  highlight: { path: string; line_start: number; line_end: number } | null,
) {
  if (!highlight || highlight.path !== filePath) {
    return;
  }
  const modified = diffEd.getModifiedEditor();
  modified.revealLinesInCenter(highlight.line_start, highlight.line_end);
  modified.setSelection({
    startLineNumber: highlight.line_start,
    startColumn: 1,
    endLineNumber: highlight.line_end,
    endColumn: 1,
  });
}

export default function DiffViewer({ diff, language, filePath }: DiffViewerProps) {
  const diffEditorRef = useRef<MonacoEditor.IStandaloneDiffEditor | null>(null);
  const addCommentToStore = useStore((s) => s.addComment);
  const setSelection = useStore((s) => s.setSelection);
  const activeHighlight = useStore((s) => s.activeHighlight);
  const bumpCenterReload = useStore((s) => s.bumpCenterReload);

  const handleMount = useCallback(
    (editor: MonacoEditor.IStandaloneDiffEditor) => {
      diffEditorRef.current = editor;
      const modified = editor.getModifiedEditor();
      const original = editor.getOriginalEditor();

      const syncSelectionFromModified = (e: MonacoEditor.ICursorSelectionChangedEvent) => {
        const start = e.selection.startLineNumber;
        const end = e.selection.endLineNumber;
        if (start !== end || e.selection.startColumn !== e.selection.endColumn) {
          setSelection({ line_start: start, line_end: end });
        } else {
          setSelection(null);
        }
      };

      modified.onDidChangeCursorSelection(syncSelectionFromModified);
      original.onDidChangeCursorSelection(() => {
        setSelection(null);
      });

      applyDiffModifiedHighlight(editor, filePath, useStore.getState().activeHighlight);
    },
    [filePath, setSelection],
  );

  useEffect(() => {
    const diffEd = diffEditorRef.current;
    if (!diffEd) {
      return;
    }
    applyDiffModifiedHighlight(diffEd, filePath, activeHighlight);
  }, [activeHighlight, filePath]);

  const handleAddComment = useCallback(async () => {
    const diffEd = diffEditorRef.current;
    if (!diffEd) {
      return;
    }
    const modified = diffEd.getModifiedEditor();
    const sel = modified.getSelection();
    if (!sel) {
      return;
    }
    const start = sel.startLineNumber;
    const end = sel.endLineNumber;
    const highlighted_text = modified.getModel()?.getValueInRange(sel) ?? "";
    try {
      const comment = await createComment(filePath, start, end, "", highlighted_text);
      addCommentToStore(comment);
    } catch (e) {
      console.error("Failed to create comment:", e);
    }
  }, [filePath, addCommentToStore]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key === "c") {
        e.preventDefault();
        handleAddComment();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleAddComment]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-3 px-3 py-1.5 bg-gray-800 border-b border-gray-700 shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="text-xs text-gray-400 font-mono truncate">{diff.path}</span>
          <span className="text-xs text-red-400 shrink-0">Original (HEAD)</span>
          <span className="text-xs shrink-0">→</span>
          <span className="text-xs text-green-400 shrink-0">Modified (working tree)</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => bumpCenterReload()}
            aria-label="Reload: refresh git diff from disk"
            title="Reload git diff (after the file changes on disk)"
            className={toolbarBtnNeutral}
          >
            <IconRefresh className={toolbarIconClass} />
            <span>Reload</span>
          </button>
          <button
            type="button"
            onClick={handleAddComment}
            aria-label="Add comment on modified side (Ctrl+Alt+C)"
            title="Add comment on modified side (Ctrl+Alt+C)"
            className={toolbarBtnPrimary}
          >
            <IconPlus className={toolbarIconClass} />
            <span>Add</span>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <DiffEditor
          height="100%"
          language={language}
          original={diff.original || ""}
          modified={diff.modified || ""}
          theme="vs-dark"
          onMount={handleMount}
          options={{
            readOnly: true,
            renderSideBySide: false,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            lineNumbers: "on",
          }}
        />
      </div>
    </div>
  );
}
