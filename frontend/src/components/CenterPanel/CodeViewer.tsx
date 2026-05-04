import { useEffect, useRef, useCallback } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { useStore } from "../../store";
import { createComment } from "../../api";
import { IconPlus, IconRefresh, toolbarBtnNeutral, toolbarBtnPrimary, toolbarIconClass } from "../ui/toolbarIcons";

interface CodeViewerProps {
  content: string;
  language: string;
  filePath: string;
}

function applyCodeHighlight(
  editor: MonacoEditor.IStandaloneCodeEditor,
  filePath: string,
  highlight: { path: string; line_start: number; line_end: number } | null,
) {
  if (!highlight || highlight.path !== filePath) {
    return;
  }
  editor.revealLinesInCenter(highlight.line_start, highlight.line_end);
  editor.setSelection({
    startLineNumber: highlight.line_start,
    startColumn: 1,
    endLineNumber: highlight.line_end,
    endColumn: 1,
  });
}

export default function CodeViewer({ content, language, filePath }: CodeViewerProps) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const addCommentToStore = useStore((s) => s.addComment);
  const setSelection = useStore((s) => s.setSelection);
  const activeHighlight = useStore((s) => s.activeHighlight);
  const bumpCenterReload = useStore((s) => s.bumpCenterReload);
  const theme = useStore((s) => s.theme);

  const handleMount: OnMount = useCallback(
    (editor) => {
      editorRef.current = editor;

      editor.onDidChangeCursorSelection((e) => {
        const start = e.selection.startLineNumber;
        const end = e.selection.endLineNumber;
        if (start !== end || e.selection.startColumn !== e.selection.endColumn) {
          setSelection({ line_start: start, line_end: end });
        } else {
          setSelection(null);
        }
      });

      // First click: highlight effect often runs before onMount — apply pending highlight now
      applyCodeHighlight(editor, filePath, useStore.getState().activeHighlight);
    },
    [filePath, setSelection],
  );

  // Highlight when activeHighlight changes (editor already mounted)
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) {
      return;
    }
    applyCodeHighlight(editor, filePath, activeHighlight);
  }, [activeHighlight, filePath]);

  const handleAddComment = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    const sel = editor.getSelection();
    if (!sel) return;
    const start = sel.startLineNumber;
    const end = sel.endLineNumber;
    const highlighted_text = editor.getModel()?.getValueInRange(sel) ?? "";
    try {
      const comment = await createComment(filePath, start, end, "", highlighted_text);
      addCommentToStore(comment);
    } catch (e) {
      console.error("Failed to create comment:", e);
    }
  }, [filePath, addCommentToStore]);

  // Ctrl+Alt+C keyboard shortcut
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
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700 shrink-0 gap-2">
        <span className="text-xs text-gray-400 font-mono truncate min-w-0">{filePath}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => bumpCenterReload()}
            aria-label="Reload: fetch the latest file content from disk"
            title="Reload from disk (after the file changes on disk)"
            className={toolbarBtnNeutral}
          >
            <IconRefresh className={toolbarIconClass} />
            <span>Reload</span>
          </button>
          <button
            type="button"
            onClick={handleAddComment}
            aria-label="Add comment from current selection (Ctrl+Alt+C)"
            title="Add Comment (Ctrl+Alt+C)"
            className={toolbarBtnPrimary}
          >
            <IconPlus className={toolbarIconClass} />
            <span>Add (Ctrl+Alt+C)</span>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={language}
          value={content}
          theme={theme === "dark" ? "vs-dark" : "vs"}
          onMount={handleMount}
          options={{
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: 13,
            lineNumbers: "on",
            wordWrap: "off",
            renderLineHighlight: "line",
            selectionHighlight: true,
            occurrencesHighlight: "off",
          }}
        />
      </div>
    </div>
  );
}
