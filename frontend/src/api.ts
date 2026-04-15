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

export function createComment(
  file_path: string,
  line_start: number,
  line_end: number,
  text = "",
  highlighted_text = ""
): Promise<Comment> {
  return json<Comment>("/api/comments", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ file_path, line_start, line_end, text, highlighted_text }),
  });
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

export function getConfig(): Promise<{ output_stem: string; output_dir: string }> {
  return json<{ output_stem: string; output_dir: string }>("/api/config");
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
