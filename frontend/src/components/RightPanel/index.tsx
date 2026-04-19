import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../../store";
import {
  saveComments,
  listReviewFiles,
  loadReviewByStem,
  getConfig,
  clearAllComments,
  deleteOutdatedComments,
  recomputeCommentStale,
} from "../../api";
import CommentBox from "./CommentBox";
import type { Comment } from "../../types";
import {
  IconClearSession,
  IconFolderLoad,
  IconRefresh,
  IconSaveToDisk,
  IconTrash,
  toolbarIconClass,
  toolbarIconOnlyClass,
} from "../ui/toolbarIcons";

type FilterMode = "all" | "file" | "folder" | "folder-deep";

function applyFilter(comments: Comment[], mode: FilterMode, openFilePath: string | null): Comment[] {
  if (mode === "all" || !openFilePath) return comments;
  if (mode === "file") return comments.filter((c) => c.file_path === openFilePath);
  const dir = openFilePath.includes("/")
    ? openFilePath.slice(0, openFilePath.lastIndexOf("/"))
    : openFilePath.includes("\\")
    ? openFilePath.slice(0, openFilePath.lastIndexOf("\\"))
    : "";
  if (!dir) return comments;
  if (mode === "folder") {
    return comments.filter((c) => {
      const cdir = c.file_path.includes("/")
        ? c.file_path.slice(0, c.file_path.lastIndexOf("/"))
        : c.file_path.includes("\\")
        ? c.file_path.slice(0, c.file_path.lastIndexOf("\\"))
        : "";
      return cdir === dir;
    });
  }
  // folder-deep
  return comments.filter(
    (c) => c.file_path.startsWith(dir + "/") || c.file_path.startsWith(dir + "\\") || c.file_path === openFilePath
  );
}

export default function RightPanel() {
  const comments = useStore((s) => s.comments);
  const newestCommentId = useStore((s) => s.newestCommentId);
  const setComments = useStore((s) => s.setComments);
  const clearComments = useStore((s) => s.clearComments);
  const reorderComments = useStore((s) => s.reorderComments);
  const openFilePath = useStore((s) => s.openFilePath);
  const agentNotice = useStore((s) => s.agentNotice);
  const setAgentNotice = useStore((s) => s.setAgentNotice);

  const [saving, setSaving] = useState(false);
  const [savedPaths, setSavedPaths] = useState<{ json: string; md: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reviewStem, setReviewStem] = useState("review_comments");
  const [editingStem, setEditingStem] = useState(false);
  const stemInputRef = useRef<HTMLInputElement>(null);
  /** Value when the user opened the filename editor — restored if they commit empty text. */
  const stemSnapshotRef = useRef("review_comments");
  /** Escape sets this so the following blur does not run commit (stale closure). */
  const skipBlurCommitRef = useRef(false);

  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [reloadingStale, setReloadingStale] = useState(false);
  const [deletingOutdated, setDeletingOutdated] = useState(false);
  const [reviewFiles, setReviewFiles] = useState<string[]>([]);
  const [showLoadMenu, setShowLoadMenu] = useState(false);
  const [loadMenuHighlight, setLoadMenuHighlight] = useState(0);
  const [menuRect, setMenuRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const loadMenuRef = useRef<HTMLDivElement>(null);
  const loadBtnRef = useRef<HTMLButtonElement>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const dragIdRef = useRef<string | null>(null);

  // Fetch current output stem from server config
  useEffect(() => {
    getConfig().then((cfg) => setReviewStem(cfg.output_stem)).catch(() => {});
  }, []);

  // MCP / agent toast — auto-dismiss like a transient status message
  useEffect(() => {
    if (!agentNotice) return;
    const t = window.setTimeout(() => setAgentNotice(null), 6000);
    return () => window.clearTimeout(t);
  }, [agentNotice, setAgentNotice]);

  // Auto-scroll to newest comment
  useEffect(() => {
    if (!newestCommentId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-id="${newestCommentId}"]`) as HTMLElement | null;
    if (el) el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [newestCommentId, comments]);

  // Load review files list when load menu is opened
  const handleOpenLoadMenu = useCallback(async () => {
    const btn = loadBtnRef.current;
    if (btn) {
      const r = btn.getBoundingClientRect();
      setMenuRect({ top: r.top, left: r.left, width: Math.max(r.width, 200) });
    }
    try {
      const files = await listReviewFiles();
      setReviewFiles(files);
      setLoadMenuHighlight(0);
      setShowLoadMenu(true);
    } catch {
      setReviewFiles([]);
      setShowLoadMenu(true);
    }
  }, []);

  const handleLoadFile = useCallback(async (stem: string) => {
    setShowLoadMenu(false);
    try {
      const loaded = await loadReviewByStem(stem);
      setComments(loaded);
      setSavedPaths(null);
      setSaveError(null);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  }, [setComments]);

  // Close menu on outside click
  useEffect(() => {
    if (!showLoadMenu) return;
    const handler = (e: MouseEvent) => {
      if (loadMenuRef.current && !loadMenuRef.current.contains(e.target as Node)) {
        setShowLoadMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showLoadMenu]);

  // Keyboard nav in load menu
  const handleLoadMenuKey = useCallback((e: React.KeyboardEvent) => {
    if (!showLoadMenu) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setLoadMenuHighlight((h) => Math.min(h + 1, reviewFiles.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setLoadMenuHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && reviewFiles[loadMenuHighlight]) {
      handleLoadFile(reviewFiles[loadMenuHighlight]);
    } else if (e.key === "Escape") {
      setShowLoadMenu(false);
    }
  }, [showLoadMenu, reviewFiles, loadMenuHighlight, handleLoadFile]);

  const commitStemEdit = useCallback(() => {
    skipBlurCommitRef.current = false;
    const trimmed = reviewStem.trim();
    if (!trimmed) {
      setReviewStem(stemSnapshotRef.current);
    } else {
      setReviewStem(trimmed);
    }
    setEditingStem(false);
  }, [reviewStem]);

  const cancelStemEdit = useCallback(() => {
    skipBlurCommitRef.current = true;
    setReviewStem(stemSnapshotRef.current);
    setEditingStem(false);
  }, []);

  const handleReloadCommentStale = async () => {
    if (comments.length === 0) return;
    setSaveError(null);
    setReloadingStale(true);
    try {
      const updated = await recomputeCommentStale();
      setComments(updated);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setReloadingStale(false);
    }
  };

  const handleClearAll = async () => {
    if (comments.length === 0) return;
    const n = comments.length;
    const ok = window.confirm(
      `Remove all ${n} comment(s) from this session?\n\n` +
        "Saved files on disk are not changed until you save again.",
    );
    if (!ok) return;
    setSaveError(null);
    try {
      await clearAllComments();
      clearComments();
      setSavedPaths(null);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    setSavedPaths(null);
    try {
      const result = await saveComments(reviewStem || undefined);
      setSavedPaths({ json: result.json_path, md: result.md_path });
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSortByFile = () => {
    const sorted = [...comments].sort((a, b) => {
      const fp = a.file_path.localeCompare(b.file_path);
      if (fp !== 0) return fp;
      return a.line_start - b.line_start;
    });
    setComments(sorted);
  };

  // --- Drag and drop ---
  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    dragIdRef.current = id;
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const srcId = dragIdRef.current;
    dragIdRef.current = null;
    if (!srcId || srcId === targetId) return;
    const ids = comments.map((c) => c.id);
    const srcIdx = ids.indexOf(srcId);
    const tgtIdx = ids.indexOf(targetId);
    if (srcIdx === -1 || tgtIdx === -1) return;
    const reordered = [...ids];
    reordered.splice(srcIdx, 1);
    reordered.splice(tgtIdx, 0, srcId);
    reorderComments(reordered);
  }, [comments, reorderComments]);

  const visible = applyFilter(comments, filterMode, openFilePath);
  const outdatedCount = comments.filter((c) => c.outdated).length;

  const handleDeleteOutdated = async () => {
    if (outdatedCount === 0) return;
    const ok = window.confirm(
      `Remove ${outdatedCount} outdated comment(s)?\n\n` +
        "Saved files on disk are not changed until you save again.",
    );
    if (!ok) return;
    setSaveError(null);
    setDeletingOutdated(true);
    try {
      const remaining = await deleteOutdatedComments();
      setComments(remaining);
      setSavedPaths(null);
    } catch (e: unknown) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingOutdated(false);
    }
  };

  return (
    <div className="flex flex-col h-full bg-gray-800 border-l border-gray-700">
      {/* Header: title + filters, then full-width divider, then Clear all */}
      <div className="flex flex-col shrink-0 border-b border-gray-700">
        <div className="flex items-start justify-between px-3 py-2 gap-2">
          <h2 className="text-sm font-semibold text-gray-200 shrink-0">
            Review Comments
            {comments.length > 0 && (
              <span className="ml-1.5 text-xs bg-blue-700 text-blue-100 px-1.5 rounded-full">
                {visible.length !== comments.length ? `${visible.length}/${comments.length}` : comments.length}
              </span>
            )}
          </h2>

          <div className="flex items-center gap-1 shrink-0">
            {/* Sort by file */}
            <button
              type="button"
              onClick={handleSortByFile}
              title="Sort by file path"
              className="px-1.5 py-0.5 text-gray-400 hover:text-gray-200 text-sm rounded hover:bg-gray-700"
            >
              ⇅
            </button>

            {/* Filter dropdown */}
            <select
              value={filterMode}
              onChange={(e) => setFilterMode(e.target.value as FilterMode)}
              className="text-xs bg-gray-700 border border-gray-600 text-gray-200 rounded px-1 py-0.5 focus:outline-none focus:border-blue-500"
              title="Filter comments"
            >
              <option value="all">All</option>
              <option value="file">This file</option>
              <option value="folder">This folder</option>
              <option value="folder-deep">Folder + sub</option>
            </select>
          </div>
        </div>

        <div className="border-t border-gray-700 px-3 py-1.5 flex flex-wrap justify-end items-center gap-1.5">
          <button
            type="button"
            onClick={handleReloadCommentStale}
            disabled={comments.length === 0 || reloadingStale}
            aria-label="Reload comments: re-scan files on disk and update which comments are marked outdated."
            title="Re-scan files and update outdated marks (strikethrough) against highlighted text"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-gray-600 hover:bg-gray-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <IconRefresh className={toolbarIconClass} />
            <span>{reloadingStale ? "…" : "Reload"}</span>
          </button>
          <button
            type="button"
            onClick={handleDeleteOutdated}
            disabled={outdatedCount === 0 || deletingOutdated}
            aria-label={`Delete outdated: remove ${outdatedCount} comment(s) marked outdated. Run Reload first so marks are current. Disk files unchanged until you save.`}
            title="Remove every comment marked outdated (use Reload first to refresh marks)"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-rose-900/60 hover:bg-rose-800/70 text-white border border-rose-700/50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <IconTrash className={toolbarIconClass} />
            <span>{deletingOutdated ? "…" : "Outdated"}</span>
          </button>
          <button
            type="button"
            onClick={handleClearAll}
            disabled={comments.length === 0}
            aria-label="Clear all: remove every comment from this session. Saved JSON on disk is unchanged until you save again."
            title="Remove every comment from this session (disk files unchanged until you save)"
            className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium rounded bg-blue-700 hover:bg-blue-600 text-white disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <IconClearSession className={toolbarIconClass} />
            <span>Clear all</span>
          </button>
        </div>
      </div>

      {/* Comment list */}
      <div ref={listRef} className="monaco-like-scrollbar flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {visible.length === 0 ? (
          <div className="text-gray-500 text-sm text-center mt-8">
            {comments.length === 0 ? (
              <>
                <p>No comments yet.</p>
                <p className="mt-2 text-xs">
                  Select text in a file and click<br />
                  <span className="text-blue-400">Add</span> in the center panel toolbar.
                </p>
              </>
            ) : (
              <p>No comments match the current filter.</p>
            )}
          </div>
        ) : (
          visible.map((c) => (
            <CommentBox
              key={c.id}
              comment={c}
              isNew={c.id === newestCommentId}
              draggable
              onDragStart={(e) => handleDragStart(e, c.id)}
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, c.id)}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-gray-700 px-3 py-2 flex flex-col gap-1.5" onKeyDown={handleLoadMenuKey}>
        {agentNotice && (
          <div className="flex flex-col gap-0.5 bg-gray-900 rounded px-2 py-1.5 relative border border-blue-600/40">
            <button
              type="button"
              onClick={() => setAgentNotice(null)}
              className="absolute top-1 right-1.5 text-gray-500 hover:text-gray-300 text-xs leading-none"
              title="Dismiss"
            >
              ✕
            </button>
            <p className="text-xs text-blue-300 truncate pr-4" title={agentNotice}>
              {agentNotice}
            </p>
          </div>
        )}
        {/* Saved paths — dismissible */}
        {savedPaths && (
          <div className="flex flex-col gap-0.5 bg-gray-900 rounded px-2 py-1.5 relative">
            <button
              onClick={() => setSavedPaths(null)}
              className="absolute top-1 right-1.5 text-gray-500 hover:text-gray-300 text-xs leading-none"
              title="Dismiss"
            >
              ✕
            </button>
            <p className="text-xs text-green-400 truncate pr-4" title={savedPaths.json}>
              JSON: {savedPaths.json}
            </p>
            <p className="text-xs text-green-400 truncate pr-4" title={savedPaths.md}>
              MD: {savedPaths.md}
            </p>
          </div>
        )}
        {saveError && (
          <p className="text-xs text-red-400">{saveError}</p>
        )}

        {/* Action row: load · filename · save */}
        <div className="flex items-center gap-1.5">
          {/* Load button */}
          <div className="relative" ref={loadMenuRef}>
            <button
              type="button"
              ref={loadBtnRef}
              onClick={handleOpenLoadMenu}
              aria-label="Load a saved review from disk"
              title="Load a saved review"
              className="inline-flex items-center justify-center p-1.5 rounded text-gray-300 hover:text-white hover:bg-gray-600 border border-transparent hover:border-gray-500"
            >
              <IconFolderLoad className={toolbarIconOnlyClass} />
            </button>
          </div>

          {editingStem ? (
            <input
              ref={stemInputRef}
              value={reviewStem}
              onChange={(e) => setReviewStem(e.target.value.replace(/[\\/]/g, ""))}
              onBlur={() => {
                if (skipBlurCommitRef.current) {
                  skipBlurCommitRef.current = false;
                  return;
                }
                commitStemEdit();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  commitStemEdit();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  cancelStemEdit();
                }
              }}
              className="flex-1 text-xs text-gray-200 font-mono bg-gray-700 border border-blue-500 rounded px-1 py-0.5 focus:outline-none min-w-0"
              spellCheck={false}
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                skipBlurCommitRef.current = false;
                stemSnapshotRef.current = reviewStem.trim() || "review_comments";
                setEditingStem(true);
                setTimeout(() => stemInputRef.current?.select(), 0);
              }}
              className="flex-1 text-xs text-gray-400 hover:text-gray-200 font-mono truncate text-left"
              title="Click to rename"
            >
              {reviewStem}
            </button>
          )}

          {/* Save — icon only */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || comments.length === 0}
            aria-label="Save review to JSON and Markdown on disk"
            title="Save review"
            className="inline-flex items-center justify-center p-1.5 rounded text-gray-300 hover:text-blue-300 disabled:opacity-40 hover:bg-gray-600 border border-transparent hover:border-gray-500 transition-colors"
          >
            {saving ? (
              <IconRefresh className={`${toolbarIconOnlyClass} animate-spin`} />
            ) : (
              <IconSaveToDisk className={toolbarIconOnlyClass} />
            )}
          </button>
        </div>
      </div>

      {/* Load menu — rendered via portal to escape overflow-hidden ancestors */}
      {showLoadMenu && menuRect && createPortal(
        <div
          ref={loadMenuRef}
          style={{
            position: "fixed",
            bottom: window.innerHeight - menuRect.top,
            left: menuRect.left,
            minWidth: menuRect.width,
            zIndex: 9999,
          }}
          className="monaco-like-scrollbar bg-gray-900 border border-gray-600 rounded shadow-2xl max-h-60 overflow-y-auto"
          onKeyDown={handleLoadMenuKey}
        >
          {reviewFiles.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-500">No saved reviews found</p>
          ) : (
            reviewFiles.map((stem, i) => (
              <button
                key={stem}
                onClick={() => handleLoadFile(stem)}
                className={`w-full text-left px-3 py-1.5 text-xs text-gray-200 hover:bg-gray-700 ${i === loadMenuHighlight ? "bg-gray-700" : ""}`}
              >
                {stem}
              </button>
            ))
          )}
        </div>,
        document.body
      )}
    </div>
  );
}

