import { useState, useEffect, useRef, useCallback } from "react";
import type { Comment } from "../../types";
import { deleteComment, updateCommentText } from "../../api";
import { useStore } from "../../store";

interface CommentBoxProps {
  comment: Comment;
  isNew?: boolean;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
}

export default function CommentBox({
  comment,
  isNew = false,
  draggable = false,
  onDragStart,
  onDragOver,
  onDrop,
}: CommentBoxProps) {
  const removeComment = useStore((s) => s.removeComment);
  const updateComment = useStore((s) => s.updateComment);
  const openFile = useStore((s) => s.openFile);
  const setActiveHighlight = useStore((s) => s.setActiveHighlight);
  const clearNewestCommentId = useStore((s) => s.clearNewestCommentId);

  const [text, setText] = useState(comment.text);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** Resize textarea to fit content, capped at 50vh. */
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    const maxH = window.innerHeight / 3;
    ta.style.height = `${Math.min(ta.scrollHeight, maxH)}px`;
    ta.style.overflowY = ta.scrollHeight > maxH ? "auto" : "hidden";
  }, []);

  // Auto-focus textarea when this is a newly created comment
  useEffect(() => {
    if (isNew) {
      textareaRef.current?.focus();
      clearNewestCommentId();
    }
  }, [isNew, clearNewestCommentId]);

  // Sync text from prop (e.g. when a saved review is loaded) and auto-resize
  useEffect(() => {
    setText(comment.text);
  }, [comment.text]);

  // Auto-resize whenever text changes
  useEffect(() => {
    autoResize();
  }, [text, autoResize]);

  const handleReferenceClick = () => {
    openFile(comment.file_path, "view");
    setActiveHighlight({
      path: comment.file_path,
      line_start: comment.line_start,
      line_end: comment.line_end,
      region_x1: comment.region_x1,
      region_y1: comment.region_y1,
      region_x2: comment.region_x2,
      region_y2: comment.region_y2,
      pdf_page: comment.pdf_page ?? null,
      highlighted_text: comment.highlighted_text || null,
    });
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
  };

  const handleBlur = async () => {
    if (text === comment.text) return;
    setSaving(true);
    try {
      const updated = await updateCommentText(comment.id, text);
      updateComment(updated);
    } catch (e) {
      console.error("Failed to update comment:", e);
      setText(comment.text);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteComment(comment.id);
      removeComment(comment.id);
    } catch (e) {
      console.error("Failed to delete comment:", e);
      setDeleting(false);
    }
  };

  const outdated = Boolean(comment.outdated);
  const hasPdfTextAnchor =
    comment.pdf_page != null &&
    comment.region_x1 == null &&
    comment.highlighted_text.trim().length > 0;

  return (
    <div
      className={`bg-gray-800 border rounded-lg p-3 flex flex-col gap-2 ${
        outdated
          ? "border-rose-500/70 ring-1 ring-rose-400/40 bg-rose-950/20"
          : "border-gray-700"
      }`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      data-id={comment.id}
    >
      {/* Top row: drag handle · reference link (centered) · delete */}
      <div className="flex items-center gap-1">
        {draggable ? (
          <span
            className="shrink-0 text-gray-600 hover:text-gray-400 cursor-grab text-base select-none"
            title="Drag to reorder"
          >
            ⠿
          </span>
        ) : <span className="shrink-0 w-4" />}
        <button
          onClick={handleReferenceClick}
          className={`flex-1 text-xs font-mono text-center break-all leading-tight ${
            outdated
              ? "text-rose-200/90 line-through decoration-rose-300 decoration-2 hover:text-rose-100"
              : "text-blue-400 hover:text-blue-300"
          }`}
          title={
            outdated
              ? "Jump to location (highlighted source may have changed)"
              : "Jump to this location in the file"
          }
        >
          {comment.reference}
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="shrink-0 text-gray-500 hover:text-red-400 text-sm transition-colors disabled:opacity-50"
          title="Delete comment"
        >
          ✕
        </button>
      </div>

      {outdated && (
        <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-300 bg-rose-950/50 border border-rose-600/50 rounded px-2 py-1">
          Outdated — highlighted source no longer matches this range
        </div>
      )}

      {hasPdfTextAnchor && (
        <div className="text-xs text-gray-300 bg-gray-900/70 border border-gray-700 rounded px-2 py-1 whitespace-pre-wrap max-h-28 overflow-auto">
          {comment.highlighted_text}
        </div>
      )}

      {/* Comment textarea – auto-resizes up to 50vh */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleTextChange}
        onBlur={handleBlur}
        placeholder="Add your review comment…"
        rows={1}
        className={`w-full text-sm rounded px-2 py-1.5 resize-none focus:outline-none overflow-hidden ${
          outdated
            ? "bg-rose-950/40 text-rose-100/90 line-through decoration-rose-300 decoration-2 border border-rose-700/60 focus:border-rose-500 placeholder-rose-300/50"
            : "bg-gray-700 text-gray-100 placeholder-gray-500 border border-gray-600 focus:border-blue-500"
        }`}
      />

      {saving && (
        <span className="text-xs text-gray-500">Saving…</span>
      )}
    </div>
  );
}
