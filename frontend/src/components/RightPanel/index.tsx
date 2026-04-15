import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useStore } from "../../store";
import { saveComments, listReviewFiles, loadReviewByStem, getConfig } from "../../api";
import CommentBox from "./CommentBox";
import type { Comment } from "../../types";

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
  const reorderComments = useStore((s) => s.reorderComments);
  const openFilePath = useStore((s) => s.openFilePath);

  const [saving, setSaving] = useState(false);
  const [savedPaths, setSavedPaths] = useState<{ json: string; md: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [reviewStem, setReviewStem] = useState("review_comments");
  const [editingStem, setEditingStem] = useState(false);
  const stemInputRef = useRef<HTMLInputElement>(null);

  const [filterMode, setFilterMode] = useState<FilterMode>("all");
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

  return (
    <div className="flex flex-col h-full bg-gray-800 border-l border-gray-700">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 shrink-0 gap-1">
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

      {/* Comment list */}
      <div ref={listRef} className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        {visible.length === 0 ? (
          <div className="text-gray-500 text-sm text-center mt-8">
            {comments.length === 0 ? (
              <>
                <p>No comments yet.</p>
                <p className="mt-2 text-xs">
                  Select text in a file and click<br />
                  <span className="text-blue-400">+ Add Comment</span>.
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
              ref={loadBtnRef}
              onClick={handleOpenLoadMenu}
              title="Load a saved review"
              className="px-1.5 py-1 text-gray-400 hover:text-gray-200 text-base rounded hover:bg-gray-700"
            >
              📂
            </button>
          </div>

          {editingStem ? (
            <input
              ref={stemInputRef}
              value={reviewStem}
              onChange={(e) => setReviewStem(e.target.value.replace(/[\\/]/g, ""))}
              onBlur={() => setEditingStem(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") setEditingStem(false);
              }}
              className="flex-1 text-xs text-gray-200 font-mono bg-gray-700 border border-blue-500 rounded px-1 py-0.5 focus:outline-none min-w-0"
              spellCheck={false}
            />
          ) : (
            <button
              onClick={() => { setEditingStem(true); setTimeout(() => stemInputRef.current?.select(), 0); }}
              className="flex-1 text-xs text-gray-400 hover:text-gray-200 font-mono truncate text-left"
              title="Click to rename"
            >
              {reviewStem}
            </button>
          )}

          {/* Save button — icon only */}
          <button
            onClick={handleSave}
            disabled={saving || comments.length === 0}
            title="Save review"
            className="px-1.5 py-1 text-gray-400 hover:text-blue-400 disabled:opacity-40 text-base rounded hover:bg-gray-700 transition-colors"
          >
            {saving ? "⏳" : "💾"}
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
          className="bg-gray-900 border border-gray-600 rounded shadow-2xl max-h-60 overflow-y-auto"
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

