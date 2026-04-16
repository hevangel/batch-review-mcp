// TypeScript interfaces matching backend Pydantic models

export interface FileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileInfo[];
  language?: string;
}

export interface GitChange {
  path: string;
  /** M=modified, A=added, D=deleted, R=renamed, ?=untracked */
  status: string;
}

export interface Comment {
  id: string;
  file_path: string;
  line_start: number;
  line_end: number;
  /** "@filename:L10-15" style reference */
  reference: string;
  text: string;
  highlighted_text: string;
  created_at: string;
}

export interface FileContentResponse {
  content: string;
  line_count: number;
  language: string;
  path: string;
}

export interface DiffResponse {
  path: string;
  original: string;
  modified: string;
  diff: string;
}

// WebSocket event types
export type WsEventType =
  | "open_file"
  | "add_comment"
  | "delete_comment"
  | "highlight"
  | "refresh_comments"
  | "refresh_files"
  | "close_file"
  | "set_left_tab"
  | "agent_notice";

export interface WsEvent<T = unknown> {
  type: WsEventType;
  payload: T;
}

export interface OpenFilePayload {
  path: string;
  mode: "view" | "diff";
}

export interface HighlightPayload {
  path: string;
  line_start: number;
  line_end: number;
}

export interface DeleteCommentPayload {
  id: string;
}

export interface AgentNoticePayload {
  message: string;
}

/** How the center panel is currently displaying content */
export type ViewMode = "view" | "diff";

/** Which left-panel tab is active */
export type LeftTab = "files" | "git";
