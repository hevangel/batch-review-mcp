import { create } from "zustand";
import type { Comment, HighlightPayload, LeftTab, ViewMode } from "./types";

interface SelectionRange {
  line_start: number;
  line_end: number;
}

interface AppStore {
  // Left panel
  activeTab: LeftTab;
  setActiveTab: (tab: LeftTab) => void;

  // Files version — bump to trigger file tree reload
  filesVersion: number;
  bumpFilesVersion: () => void;

  // Center panel
  openFilePath: string | null;
  openMode: ViewMode;
  openFile: (path: string, mode?: ViewMode) => void;
  closeFile: () => void;

  // Selection in center panel (for creating comments)
  selection: SelectionRange | null;
  setSelection: (sel: SelectionRange | null) => void;

  // Active highlight (from clicking a comment)
  activeHighlight: HighlightPayload | null;
  setActiveHighlight: (h: HighlightPayload | null) => void;

  // Comments (right panel)
  comments: Comment[];
  newestCommentId: string | null;
  setComments: (comments: Comment[]) => void;
  addComment: (comment: Comment) => void;
  removeComment: (id: string) => void;
  updateComment: (comment: Comment) => void;
  reorderComments: (orderedIds: string[]) => void;
  clearNewestCommentId: () => void;
}

export const useStore = create<AppStore>((set) => ({
  activeTab: "files",
  setActiveTab: (tab) => set({ activeTab: tab }),

  filesVersion: 0,
  bumpFilesVersion: () => set((s) => ({ filesVersion: s.filesVersion + 1 })),

  openFilePath: null,
  openMode: "view",
  openFile: (path, mode = "view") =>
    set({ openFilePath: path, openMode: mode, selection: null }),
  closeFile: () => set({ openFilePath: null, selection: null }),

  selection: null,
  setSelection: (sel) => set({ selection: sel }),

  activeHighlight: null,
  setActiveHighlight: (h) => set({ activeHighlight: h }),

  comments: [],
  newestCommentId: null,
  setComments: (comments) => set({ comments }),
  addComment: (comment) =>
    set((s) => {
      const exists = s.comments.find((c) => c.id === comment.id);
      if (exists) {
        return { comments: s.comments.map((c) => (c.id === comment.id ? comment : c)) };
      }
      return { comments: [...s.comments, comment], newestCommentId: comment.id };
    }),
  removeComment: (id) =>
    set((s) => ({ comments: s.comments.filter((c) => c.id !== id) })),
  updateComment: (comment) =>
    set((s) => ({
      comments: s.comments.map((c) => (c.id === comment.id ? comment : c)),
    })),
  reorderComments: (orderedIds) =>
    set((s) => {
      const map = new Map(s.comments.map((c) => [c.id, c]));
      const reordered = orderedIds.flatMap((id) => (map.has(id) ? [map.get(id)!] : []));
      // Append any comments not in orderedIds at the end
      const inOrder = new Set(orderedIds);
      for (const c of s.comments) {
        if (!inOrder.has(c.id)) reordered.push(c);
      }
      return { comments: reordered };
    }),
  clearNewestCommentId: () => set({ newestCommentId: null }),
}));
