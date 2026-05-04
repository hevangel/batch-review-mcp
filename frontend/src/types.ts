// TypeScript interfaces matching backend Pydantic models

export interface FileInfo {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileInfo[];
  children_loaded?: boolean;
  has_children?: boolean;
  language?: string;
}

export interface GitChange {
  path: string;
  old_path?: string | null;
  /** M=modified, A=added, D=deleted, R=renamed, ?=untracked */
  status: string;
  base_label?: string | null;
  head_label?: string | null;
}

export type GitCompareMode = "local" | "commit" | "pr";

export interface GitCompareParams {
  mode: GitCompareMode;
  base?: string;
  head?: string;
  pr?: string;
}

export interface Comment {
  id: string;
  file_path: string;
  line_start: number;
  line_end: number;
  /** "@filename:L10-15" or "@image.png:rect(x1,y1,x2,y2)" style reference */
  reference: string;
  text: string;
  highlighted_text: string;
  region_x1?: number | null;
  region_y1?: number | null;
  region_x2?: number | null;
  region_y2?: number | null;
  /** 1-based PDF page when ``region_*`` are normalized 0–1 on that page. */
  pdf_page?: number | null;
  /** Optional richer anchor metadata for rendered HTML comments. */
  anchor_kind?: string | null;
  html_selector?: string | null;
  html_fingerprint?: string | null;
  /** PNG filename saved beside the review JSON for visual region comments. */
  region_screenshot_file?: string | null;
  region_screenshot_width?: number | null;
  region_screenshot_height?: number | null;
  created_at: string;
  /** True when the file text at this range no longer matches highlighted_text. */
  outdated?: boolean;
}

export interface FileContentResponse {
  content: string;
  line_count: number;
  language: string;
  path: string;
}

export interface DiffResponse {
  path: string;
  old_path?: string | null;
  original: string;
  modified: string;
  diff: string;
  base_label?: string | null;
  head_label?: string | null;
  base_ref?: string | null;
  head_ref?: string | null;
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
  | "agent_notice"
  | "mcp_session";

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
  region_x1?: number | null;
  region_y1?: number | null;
  region_x2?: number | null;
  region_y2?: number | null;
  pdf_page?: number | null;
  highlighted_text?: string | null;
  anchor_kind?: string | null;
  html_selector?: string | null;
  html_fingerprint?: string | null;
}

export interface DeleteCommentPayload {
  id: string;
}

export interface AgentNoticePayload {
  message: string;
}

/** Payload for ``mcp_session`` WebSocket events (matches MCP ``init_batch_review_session``). */
export interface McpSessionPayload {
  coding_agent: string;
  model_name: string;
  client_version: string;
}

/** How the center panel is currently displaying content */
export type ViewMode = "view" | "diff";

/** Which left-panel tab is active */
export type LeftTab = "files" | "git";

export type ThemeMode = "dark" | "light";
