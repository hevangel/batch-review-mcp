import { useEffect, useRef, useCallback } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { useStore } from "../../store";
import { createComment } from "../../api";

interface CodeViewerProps {
  content: string;
  language: string;
  filePath: string;
}

export default function CodeViewer({ content, language, filePath }: CodeViewerProps) {
  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const addCommentToStore = useStore((s) => s.addComment);
  const setSelection = useStore((s) => s.setSelection);
  const activeHighlight = useStore((s) => s.activeHighlight);

  const handleMount: OnMount = useCallback((editor) => {
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
  }, [setSelection]);

  // Highlight when activeHighlight changes
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !activeHighlight || activeHighlight.path !== filePath) return;
    editor.revealLinesInCenter(activeHighlight.line_start, activeHighlight.line_end);
    editor.setSelection({
      startLineNumber: activeHighlight.line_start,
      startColumn: 1,
      endLineNumber: activeHighlight.line_end,
      endColumn: 1,
    });
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
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700 shrink-0">
        <span className="text-xs text-gray-400 font-mono truncate">{filePath}</span>
        <button
          onClick={handleAddComment}
          title="Add Comment (Ctrl+Alt+C)"
          className="ml-2 px-2 py-0.5 bg-blue-700 hover:bg-blue-600 text-white text-xs rounded shrink-0"
        >
          + Add Comment
        </button>
      </div>
      <div className="flex-1 overflow-hidden">
        <Editor
          height="100%"
          language={language}
          value={content}
          theme="vs-dark"
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
