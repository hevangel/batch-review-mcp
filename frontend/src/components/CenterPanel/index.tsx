import { useEffect, useState } from "react";
import { useStore } from "../../store";
import { getFileContent, getGitDiff } from "../../api";
import type { DiffResponse, FileContentResponse } from "../../types";
import { IconRefresh, toolbarBtnNeutral, toolbarIconClass } from "../ui/toolbarIcons";
import MarkdownViewer from "./MarkdownViewer";
import CodeViewer from "./CodeViewer";
import DiffViewer from "./DiffViewer";
import ImageViewer from "./ImageViewer";

export default function CenterPanel() {
  const openFilePath = useStore((s) => s.openFilePath);
  const openMode = useStore((s) => s.openMode);
  const centerReloadEpoch = useStore((s) => s.centerReloadEpoch);

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

    const ext = openFilePath.split(".").pop()?.toLowerCase() ?? "";
    if (openMode === "diff") {
      getGitDiff(openFilePath)
        .then(setDiffData)
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    } else if (extToLang(ext) === "image") {
      // Images are served via a dedicated endpoint; no text content to fetch
      setFileData({ content: "", line_count: 0, language: "image", path: openFilePath });
      setLoading(false);
    } else {
      getFileContent(openFilePath)
        .then(setFileData)
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [openFilePath, openMode, centerReloadEpoch]);

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
      <div className="flex h-full flex-col items-center justify-center gap-3 bg-gray-900 text-red-400 text-sm p-6">
        <p>{error}</p>
        <button
          type="button"
          onClick={() => useStore.getState().bumpCenterReload()}
          aria-label="Reload: try loading the file again"
          title="Reload from disk"
          className={toolbarBtnNeutral}
        >
          <IconRefresh className={toolbarIconClass} />
          <span>Reload</span>
        </button>
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
    if (fileData.language === "image") {
      return <ImageViewer filePath={openFilePath} cacheBust={centerReloadEpoch} />;
    }
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
    png: "image",
    jpg: "image",
    jpeg: "image",
    gif: "image",
    webp: "image",
    bmp: "image",
    svg: "image",
    ico: "image",
  };
  return map[ext] ?? "plaintext";
}
