// Typed API client — all calls go to the same host (proxied in dev, direct in prod)

import type {
  Comment,
  DiffResponse,
  FileContentResponse,
  FileInfo,
  GitChange,
} from "./types";

const BASE = "";

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, init);
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json() as Promise<T>;
}

// ---------- File system -------------------------------------------------

export function listFiles(path = "."): Promise<FileInfo[]> {
  return json<FileInfo[]>(`/api/files?path=${encodeURIComponent(path)}`);
}

export function getFileContent(path: string): Promise<FileContentResponse> {
  return json<FileContentResponse>(
    `/api/file-content?path=${encodeURIComponent(path)}`
  );
}

// ---------- Git ---------------------------------------------------------

export function getGitChanges(): Promise<GitChange[]> {
  return json<GitChange[]>("/api/git/changes");
}

export function getGitDiff(path: string): Promise<DiffResponse> {
  return json<DiffResponse>(`/api/git/diff?path=${encodeURIComponent(path)}`);
}

// ---------- Comments ----------------------------------------------------

export function listComments(): Promise<Comment[]> {
  return json<Comment[]>("/api/comments");
}

/** Re-scan repo files and refresh each comment's ``outdated`` flag (broadcasts to all clients). */
export function recomputeCommentStale(): Promise<Comment[]> {
  return json<Comment[]>("/api/comments/recompute-stale", { method: "POST" });
}

export function createComment(
  file_path: string,
  line_start: number,
  line_end: number,
  text = "",
  highlighted_text = "",
  region?: { x1: number; y1: number; x2: number; y2: number },
  pdf_page?: number,
): Promise<Comment> {
  return json<Comment>("/api/comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      file_path, line_start, line_end, text, highlighted_text,
      ...(region ? {
        region_x1: region.x1, region_y1: region.y1,
        region_x2: region.x2, region_y2: region.y2,
      } : {}),
      ...(pdf_page != null ? { pdf_page } : {}),
    }),
  });
}

export function imageUrl(path: string, cacheBust?: number): string {
  let url = `${BASE}/api/image-content?path=${encodeURIComponent(path)}`;
  if (cacheBust !== undefined) {
    url += `&_cb=${encodeURIComponent(String(cacheBust))}`;
  }
  return url;
}

export function pdfUrl(path: string, cacheBust?: number): string {
  let url = `${BASE}/api/pdf-content?path=${encodeURIComponent(path)}`;
  if (cacheBust !== undefined) {
    url += `&_cb=${encodeURIComponent(String(cacheBust))}`;
  }
  return url;
}

export function updateCommentText(id: string, text: string): Promise<Comment> {
  return json<Comment>(`/api/comments/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
}

export function deleteComment(id: string): Promise<void> {
  return json<void>(`/api/comments/${id}`, { method: "DELETE" });
}

/** Remove every in-memory review comment (same as the right panel Clear all button). */
export async function clearAllComments(): Promise<void> {
  const res = await fetch(BASE + "/api/comments/clear", { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`API error ${res.status}: ${text}`);
  }
}

/** Remove comments marked outdated; returns the comments still in memory. */
export function deleteOutdatedComments(): Promise<Comment[]> {
  return json<Comment[]>("/api/comments/outdated", { method: "DELETE" });
}

export function saveComments(
  output_stem?: string,
  output_dir?: string
): Promise<{ json_path: string; md_path: string; comments: Comment[] }> {
  return json<{ json_path: string; md_path: string; comments: Comment[] }>("/api/comments/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      output_stem: output_stem ?? null,
      output_dir: output_dir ?? null,
    }),
  });
}

export function bulkLoadComments(
  comments: Comment[],
  replace = true
): Promise<Comment[]> {
  return json<Comment[]>("/api/comments/bulk-load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comments, replace }),
  });
}

export function getConfig(): Promise<{
  output_stem: string;
  output_dir: string;
  web_ui_url: string | null;
  mcp_session: {
    coding_agent: string;
    model_name: string;
    client_version: string;
  } | null;
}> {
  return json<{
    output_stem: string;
    output_dir: string;
    web_ui_url: string | null;
    mcp_session: {
      coding_agent: string;
      model_name: string;
      client_version: string;
    } | null;
  }>("/api/config");
}

export function listReviewFiles(): Promise<string[]> {
  return json<string[]>("/api/review-files");
}

export function loadReviewByStem(stem: string): Promise<Comment[]> {
  return json<Comment[]>("/api/comments/load", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ stem }),
  });
}
