import { DiffEditor } from "@monaco-editor/react";
import type { DiffResponse } from "../../types";

interface DiffViewerProps {
  diff: DiffResponse;
  language: string;
}

export default function DiffViewer({ diff, language }: DiffViewerProps) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-3 py-1.5 bg-gray-800 border-b border-gray-700 shrink-0">
        <span className="text-xs text-gray-400 font-mono truncate">{diff.path}</span>
        <span className="text-xs text-red-400">Original (HEAD)</span>
        <span className="text-xs">→</span>
        <span className="text-xs text-green-400">Modified (working tree)</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <DiffEditor
          height="100%"
          language={language}
          original={diff.original || ""}
          modified={diff.modified || ""}
          theme="vs-dark"
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
