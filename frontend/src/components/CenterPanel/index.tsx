import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { getFileContent, getGitDiff } from "../../api";
import type { DiffResponse, FileContentResponse } from "../../types";
import MarkdownViewer from "./MarkdownViewer";
import CodeViewer from "./CodeViewer";
import DiffViewer from "./DiffViewer";

export default function CenterPanel() {
  const openFilePath = useStore((s) => s.openFilePath);
  const openMode = useStore((s) => s.openMode);

  const [fileData, setFileData] = useState<FileContentResponse | null>(null);
  const [diffData, setDiffData] = useState<DiffResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!openFilePath) {
      setFileData(null);
      setDiffData(null);
      return;
    }
    setLoading(true);
    setError(null);
    setFileData(null);
    setDiffData(null);

    if (openMode === "diff") {
      getGitDiff(openFilePath)
        .then(setDiffData)
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    } else {
      getFileContent(openFilePath)
        .then(setFileData)
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [openFilePath, openMode]);

  if (!openFilePath) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-900 text-gray-500 text-sm">
        Select a file from the left panel to start reviewing.
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-900 text-gray-400 text-sm">
        Loading…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-900 text-red-400 text-sm p-6">
        {error}
      </div>
    );
  }

  // --- Diff mode ---
  if (openMode === "diff" && diffData) {
    const ext = openFilePath.split(".").pop()?.toLowerCase() ?? "";
    const lang = fileData?.language ?? extToLang(ext);
    return <DiffViewer diff={diffData} language={lang} filePath={openFilePath} />;
  }

  // --- View mode ---
  if (fileData) {
    if (fileData.language === "markdown") {
      return <MarkdownViewer content={fileData.content} filePath={openFilePath} />;
    }
    return (
      <CodeViewer
        content={fileData.content}
        language={fileData.language}
        filePath={openFilePath}
      />
    );
  }

  return null;
}

function extToLang(ext: string): string {
  const map: Record<string, string> = {
    py: "python",
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    json: "json",
    md: "markdown",
    html: "html",
    css: "css",
    sh: "shell",
    yaml: "yaml",
    yml: "yaml",
    rs: "rust",
    go: "go",
    java: "java",
    rb: "ruby",
    cs: "csharp",
    sql: "sql",
  };
  return map[ext] ?? "plaintext";
}
