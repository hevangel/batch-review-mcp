import { lazy, Suspense, useEffect, useState } from "react";
import { useStore } from "../../store";
import { getFileContent, getGitDiff } from "../../api";
import type { DiffResponse, FileContentResponse } from "../../types";
import { IconRefresh, toolbarBtnNeutral, toolbarIconClass } from "../ui/toolbarIcons";
import MarkdownViewer from "./MarkdownViewer";
import CodeViewer from "./CodeViewer";
import DiffViewer from "./DiffViewer";
import ImageViewer from "./ImageViewer";
import HtmlViewer from "./HtmlViewer";
const PdfViewer = lazy(() => import("./PdfViewer"));

export default function CenterPanel() {
  const openFilePath = useStore((s) => s.openFilePath);
  const openMode = useStore((s) => s.openMode);
  const centerReloadEpoch = useStore((s) => s.centerReloadEpoch);
  const gitCompare = useStore((s) => s.gitCompare);
  const gitDiffOldPath = useStore((s) => s.gitDiffOldPath);

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
      getGitDiff(openFilePath, gitCompare, gitDiffOldPath)
        .then(setDiffData)
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    } else if (extToLang(ext) === "image") {
      // Images are served via a dedicated endpoint; no text content to fetch
      setFileData({ content: "", line_count: 0, language: "image", path: openFilePath });
      setLoading(false);
    } else if (extToLang(ext) === "pdf") {
      setFileData({ content: "", line_count: 0, language: "pdf", path: openFilePath });
      setLoading(false);
    } else {
      getFileContent(openFilePath)
        .then(setFileData)
        .catch((e: Error) => setError(e.message))
        .finally(() => setLoading(false));
    }
  }, [openFilePath, openMode, centerReloadEpoch, gitCompare, gitDiffOldPath]);

  if (!openFilePath) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-900 px-6 py-10">
        <div className="max-w-xl rounded-xl border border-gray-800 bg-gray-800/80 px-6 py-7 shadow-lg">
          <h2 className="text-xl font-semibold text-gray-100">Batch Review</h2>
          <p className="mt-2 text-sm leading-6 text-gray-400">
            Open a file or diff from the left panel to start reviewing in the center panel.
          </p>
          <div className="mt-5 space-y-3 text-sm text-gray-300">
            <p>
              <span className="font-medium text-gray-100">1.</span> Choose a file in the
              <span className="mx-1 rounded bg-gray-800 px-1.5 py-0.5 text-xs font-mono text-gray-200">
                Files
              </span>
              tab, or inspect changed files in
              <span className="mx-1 rounded bg-gray-800 px-1.5 py-0.5 text-xs font-mono text-gray-200">
                Git
              </span>
              diff view.
            </p>
            <p>
              <span className="font-medium text-gray-100">2.</span> Select text, lines, or a
              region and use <span className="font-medium text-gray-100">Add</span> to create a
              review comment.
            </p>
            <p>
              <span className="font-medium text-gray-100">3.</span> Review and edit comments in
              the right panel, then save the review as JSON and Markdown.
            </p>
          </div>
        </div>
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
    if (fileData.language === "pdf") {
      return (
        <Suspense
          fallback={
            <div className="flex h-full items-center justify-center bg-gray-900 text-gray-400 text-sm">
              Loading PDF viewer…
            </div>
          }
        >
          <PdfViewer filePath={openFilePath} cacheBust={centerReloadEpoch} />
        </Suspense>
      );
    }
    if (fileData.language === "markdown") {
      return <MarkdownViewer content={fileData.content} filePath={openFilePath} />;
    }
    if (fileData.language === "html") {
      return <HtmlViewer content={fileData.content} filePath={openFilePath} />;
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
    htm: "html",
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
    pdf: "pdf",
  };
  return map[ext] ?? "plaintext";
}
