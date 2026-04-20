import { create } from "zustand";
import type { Comment, HighlightPayload, LeftTab, McpSessionPayload, ViewMode } from "./types";

interface SelectionRange {
  line_start: number;
  line_end: number;
}

interface MarkdownHashTarget {
  path: string;
  hash: string;
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
  /** Bump to re-fetch the open file (toolbar reload or server re-open of same path). */
  centerReloadEpoch: number;
  bumpCenterReload: () => void;
  openFile: (path: string, mode?: ViewMode) => void;
  /** Same as openFile but increments centerReloadEpoch when path+mode already match (MCP / WS open_file). */
  openFileFromServer: (path: string, mode?: ViewMode) => void;
  closeFile: () => void;

  // Selection in center panel (for creating comments)
  selection: SelectionRange | null;
  setSelection: (sel: SelectionRange | null) => void;

  // Image region selection (for creating image comments)
  imageRegion: { x1: number; y1: number; x2: number; y2: number } | null;
  setImageRegion: (r: { x1: number; y1: number; x2: number; y2: number } | null) => void;

  /** PDF: 1-based page + normalized 0–1 rect on that page */
  pdfRegion: { page: number; x1: number; y1: number; x2: number; y2: number } | null;
  setPdfRegion: (r: { page: number; x1: number; y1: number; x2: number; y2: number } | null) => void;

  // Active highlight (from clicking a comment)
  activeHighlight: HighlightPayload | null;
  setActiveHighlight: (h: HighlightPayload | null) => void;

  // Pending markdown hash navigation target (e.g. other.md#section)
  markdownHashTarget: MarkdownHashTarget | null;
  setMarkdownHashTarget: (target: MarkdownHashTarget | null) => void;

  // Comments (right panel)
  comments: Comment[];
  newestCommentId: string | null;
  setComments: (comments: Comment[]) => void;
  addComment: (comment: Comment) => void;
  removeComment: (id: string) => void;
  updateComment: (comment: Comment) => void;
  reorderComments: (orderedIds: string[]) => void;
  clearNewestCommentId: () => void;
  clearComments: () => void;

  /** Short-lived MCP / agent toast (right panel footer) */
  agentNotice: string | null;
  setAgentNotice: (msg: string | null) => void;

  /** Registered MCP client (coding host + model), from init tool or /api/config */
  mcpSession: McpSessionPayload | null;
  setMcpSession: (s: McpSessionPayload | null) => void;
}

export const useStore = create<AppStore>((set) => ({
  activeTab: "files",
  setActiveTab: (tab) => set({ activeTab: tab }),

  filesVersion: 0,
  bumpFilesVersion: () => set((s) => ({ filesVersion: s.filesVersion + 1 })),

  openFilePath: null,
  openMode: "view",
  centerReloadEpoch: 0,
  bumpCenterReload: () => set((s) => ({ centerReloadEpoch: s.centerReloadEpoch + 1 })),
  openFile: (path, mode = "view") =>
    set({ openFilePath: path, openMode: mode, selection: null, imageRegion: null, pdfRegion: null }),
  openFileFromServer: (path, mode = "view") =>
    set((s) => {
      const m = mode ?? "view";
      const same = s.openFilePath === path && s.openMode === m;
      return {
        openFilePath: path,
        openMode: m,
        selection: null,
        imageRegion: null,
        pdfRegion: null,
        centerReloadEpoch: same ? s.centerReloadEpoch + 1 : s.centerReloadEpoch,
      };
    }),
  closeFile: () => set({ openFilePath: null, selection: null, imageRegion: null, pdfRegion: null }),

  selection: null,
  setSelection: (sel) => set({ selection: sel }),

  imageRegion: null,
  setImageRegion: (r) => set({ imageRegion: r }),

  pdfRegion: null,
  setPdfRegion: (r) => set({ pdfRegion: r }),

  activeHighlight: null,
  setActiveHighlight: (h) => set({ activeHighlight: h }),

  markdownHashTarget: null,
  setMarkdownHashTarget: (target) => set({ markdownHashTarget: target }),

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
  clearComments: () => set({ comments: [], newestCommentId: null }),

  agentNotice: null,
  setAgentNotice: (msg) => set({ agentNotice: msg }),

  mcpSession: null,
  setMcpSession: (s) => set({ mcpSession: s }),
}));
