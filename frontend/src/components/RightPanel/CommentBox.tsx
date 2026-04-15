import { useState, useEffect, useRef } from "react";
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

  // Auto-focus textarea when this is a newly created comment
  useEffect(() => {
    if (isNew) {
      textareaRef.current?.focus();
      clearNewestCommentId();
    }
  }, [isNew, clearNewestCommentId]);

  const handleReferenceClick = () => {
    openFile(comment.file_path, "view");
    setActiveHighlight({
      path: comment.file_path,
      line_start: comment.line_start,
      line_end: comment.line_end,
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

  return (
    <div
      className="bg-gray-800 border border-gray-700 rounded-lg p-3 flex flex-col gap-2"
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
          className="flex-1 text-blue-400 hover:text-blue-300 text-xs font-mono text-center break-all leading-tight"
          title="Jump to this location in the file"
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

      {/* Comment textarea */}
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleTextChange}
        onBlur={handleBlur}
        placeholder="Add your review comment…"
        rows={3}
        className="w-full bg-gray-700 text-gray-100 text-sm placeholder-gray-500 rounded px-2 py-1.5 resize-y border border-gray-600 focus:outline-none focus:border-blue-500"
      />

      {saving && (
        <span className="text-xs text-gray-500">Saving…</span>
      )}
    </div>
  );
}
