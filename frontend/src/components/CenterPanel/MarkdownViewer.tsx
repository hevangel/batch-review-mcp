import { Children, isValidElement, useEffect, useLayoutEffect, useRef, useCallback, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import rehypeSlug from "rehype-slug";
import type { Components } from "react-markdown";
import mermaid from "mermaid";
import { useStore } from "../../store";
import { createComment, imageUrl } from "../../api";
import { IconPlus, IconRefresh, toolbarBtnNeutral, toolbarBtnPrimary, toolbarIconClass } from "../ui/toolbarIcons";

interface MarkdownViewerProps {
  content: string;
  filePath: string;
}

let mermaid_initialized = false;
let mermaid_render_count = 0;

function ensure_mermaid_initialized(): void {
  if (mermaid_initialized) {
    return;
  }
  mermaid.initialize({
    startOnLoad: false,
    theme: "dark",
    securityLevel: "strict",
  });
  mermaid_initialized = true;
}

function extract_text_content(node: unknown): string {
  if (typeof node === "string") {
    return node;
  }
  if (Array.isArray(node)) {
    return node.map(extract_text_content).join("");
  }
  if (isValidElement(node)) {
    return extract_text_content((node.props as { children?: unknown }).children);
  }
  return "";
}

function is_mermaid_class_name(value: unknown): value is string {
  return typeof value === "string" && /(?:^|\s)language-mermaid(?:\s|$)/.test(value);
}

function is_math_class_name(value: unknown): value is string {
  return typeof value === "string" && /(?:^|\s)(?:language-math|math-inline|math-display)(?:\s|$)/.test(value);
}

function normalize_github_math_markdown(content: string): string {
  const lines = content.split("\n");
  let active_fence: { marker: string; length: number } | null = null;

  return lines.map((line) => {
    const trimmed = line.trimStart();
    const fence_match = trimmed.match(/^(`{3,}|~{3,})/);

    if (fence_match) {
      const marker = fence_match[1][0];
      const length = fence_match[1].length;
      if (!active_fence) {
        active_fence = { marker, length };
        return line;
      }
      if (marker === active_fence.marker && length >= active_fence.length) {
        active_fence = null;
      }
      return line;
    }

    if (active_fence) {
      return line;
    }

    return line.replace(/\$`([^`\r\n]+?)`\$/g, (_match, expression: string) => `$$${expression}$$`);
  }).join("\n");
}

function MermaidDiagram({ chart }: { chart: string }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function render_chart() {
      try {
        ensure_mermaid_initialized();
        const id = `batch-review-mermaid-${mermaid_render_count++}`;
        const result = await mermaid.render(id, chart);
        if (cancelled) {
          return;
        }
        setSvg(result.svg);
        setError("");
      } catch (e) {
        if (cancelled) {
          return;
        }
        setSvg("");
        setError(e instanceof Error ? e.message : String(e));
      }
    }

    void render_chart();
    return () => {
      cancelled = true;
    };
  }, [chart]);

  if (error) {
    return (
      <div className="markdown-mermaid-error">
        <p className="font-medium">Mermaid render error</p>
        <p className="mt-1 text-xs text-red-300">{error}</p>
        <pre className="mt-3 overflow-x-auto rounded border border-red-900/60 bg-gray-950/80 p-3 text-xs text-gray-200">
          <code>{chart}</code>
        </pre>
      </div>
    );
  }

  if (!svg) {
    return <div className="markdown-mermaid-loading">Rendering Mermaid diagram…</div>;
  }

  return (
    <div
      className="markdown-mermaid-diagram"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/**
 * Build react-markdown `components` map that injects `data-line` attributes
 * onto every rendered block element.  We embed line numbers as data attributes
 * by wrapping the node render and reading node.position from the rehype tree.
 *
 * Because react-markdown passes `node` (rehype node) as an extra prop we can
 * extract the source position from it.
 */
function isExternalHref(href: string): boolean {
  return /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(href) || href.startsWith("//");
}

function resolveRepoHref(
  currentFilePath: string,
  href: string,
): { path: string; hash: string } | null {
  if (!href || href.startsWith("#") || isExternalHref(href)) {
    return null;
  }

  const [pathPart, hashPart = ""] = href.split("#", 2);
  const cleanPath = pathPart.split("?", 1)[0] ?? "";
  if (!cleanPath) {
    return { path: currentFilePath, hash: hashPart ? `#${hashPart}` : "" };
  }

  const baseDir =
    currentFilePath.includes("/") ?
      currentFilePath.slice(0, currentFilePath.lastIndexOf("/") + 1) :
      "";
  const base = cleanPath.startsWith("/") ? "http://repo/" : `http://repo/${baseDir}`;
  const resolved = new URL(cleanPath, base).pathname.replace(/^\/+/, "");
  return { path: decodeURIComponent(resolved), hash: hashPart ? `#${hashPart}` : "" };
}

function makeComponents(
  currentFilePath: string,
  openFile: (path: string, mode?: "view" | "diff") => void,
  scrollToHash: (hash: string) => void,
  setMarkdownHashTarget: (target: { path: string; hash: string } | null) => void,
  showMermaidSource: boolean,
): Components {
  // Shared handler — creates a wrapper with data-line
  function withLine(
    Tag: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    props: Record<string, any>
  ) {
    const { node, children, ...rest } = props as {
      node?: { position?: { start: { line: number }; end: { line: number } } };
      children: React.ReactNode;
      [k: string]: unknown;
    };
    const lineStart = node?.position?.start?.line;
    const lineEnd = node?.position?.end?.line;
    const dataProps: Record<string, unknown> = {};
    if (lineStart != null) dataProps["data-line-start"] = lineStart;
    if (lineEnd != null) dataProps["data-line-end"] = lineEnd;
    const El = Tag as React.ElementType;
    return <El {...rest} {...dataProps}>{children}</El>;
  }

  function getLineDataProps(node?: { position?: { start: { line: number }; end: { line: number } } }) {
    const dataProps: Record<string, unknown> = {};
    const lineStart = node?.position?.start?.line;
    const lineEnd = node?.position?.end?.line;
    if (lineStart != null) dataProps["data-line-start"] = lineStart;
    if (lineEnd != null) dataProps["data-line-end"] = lineEnd;
    return dataProps;
  }

  return {
    p: (props) => withLine("p", props as Record<string, unknown>),
    h1: (props) => withLine("h1", props as Record<string, unknown>),
    h2: (props) => withLine("h2", props as Record<string, unknown>),
    h3: (props) => withLine("h3", props as Record<string, unknown>),
    h4: (props) => withLine("h4", props as Record<string, unknown>),
    h5: (props) => withLine("h5", props as Record<string, unknown>),
    h6: (props) => withLine("h6", props as Record<string, unknown>),
    ul: (props) => withLine("ul", props as Record<string, unknown>),
    ol: (props) => withLine("ol", props as Record<string, unknown>),
    blockquote: (props) => withLine("blockquote", props as Record<string, unknown>),
    pre: (props) => {
      const { node, children } = props as {
        node?: { position?: { start: { line: number }; end: { line: number } } };
        children: React.ReactNode;
      };
      const renderedChildren = Children.toArray(children);
      if (renderedChildren.length === 1 && isValidElement(renderedChildren[0])) {
        const childProps = renderedChildren[0].props as {
          className?: string;
          children?: unknown;
        };
        if (is_mermaid_class_name(childProps.className) && !showMermaidSource) {
          const chart = extract_text_content(childProps.children).replace(/\n$/, "");
          return (
            <div
              className="not-prose markdown-mermaid-wrapper"
              {...getLineDataProps(node)}
            >
              <MermaidDiagram chart={chart} />
            </div>
          );
        }
        if (is_math_class_name(childProps.className)) {
          return (
            <div
              className="not-prose markdown-math-block"
              {...getLineDataProps(node)}
            >
              {children}
            </div>
          );
        }
      }
      return withLine("pre", props as Record<string, unknown>);
    },
    code: (props) => {
      const { node, children, className, ...rest } = props as {
        node?: { position?: { start: { line: number }; end: { line: number } } };
        children: React.ReactNode;
        className?: string;
        [k: string]: unknown;
      };
      if (is_math_class_name(className)) {
        return (
          <span
            {...rest}
            className={`markdown-math-rendered ${className ?? ""}`.trim()}
            {...getLineDataProps(node)}
          >
            {children}
          </span>
        );
      }
      return (
        <code
          {...rest}
          className={className}
          {...getLineDataProps(node)}
        >
          {children}
        </code>
      );
    },
    table: (props) => withLine("table", props as Record<string, unknown>),
    a: (props) => {
      const { href = "", children, ...rest } = props as {
        href?: string;
        children: React.ReactNode;
        [k: string]: unknown;
      };
      const resolved = resolveRepoHref(currentFilePath, href);
      if (resolved) {
        if (resolved.path === currentFilePath && resolved.hash) {
          return (
            <a
              {...rest}
              href={resolved.hash}
              onClick={(e) => {
                e.preventDefault();
                scrollToHash(resolved.hash);
              }}
              title={`Jump to ${resolved.hash} in this document`}
            >
              {children}
            </a>
          );
        }
        return (
          <a
            {...rest}
            href={resolved.hash || "#"}
            onClick={(e) => {
              e.preventDefault();
              if (resolved.hash) {
                setMarkdownHashTarget({ path: resolved.path, hash: resolved.hash });
              } else {
                setMarkdownHashTarget(null);
              }
              openFile(resolved.path, "view");
            }}
            title={`Open ${resolved.path} in the center panel`}
          >
            {children}
          </a>
        );
      }
      return <a {...rest} href={href}>{children}</a>;
    },
    img: (props) => {
      const { src = "", alt = "", ...rest } = props as {
        src?: string;
        alt?: string;
        [k: string]: unknown;
      };
      const resolved = resolveRepoHref(currentFilePath, src);
      const finalSrc = resolved ? imageUrl(resolved.path) : src;
      return (
        <img
          {...rest}
          src={finalSrc}
          alt={alt}
          loading="lazy"
          className="max-w-full h-auto rounded border border-gray-700"
        />
      );
    },
  };
}

/** Walk up the DOM from a node to find the nearest element with data-line-start */
function findLineAttr(node: Node | null): { start: number; end: number } | null {
  let el: Element | null = node instanceof Element ? node : node?.parentElement ?? null;
  while (el) {
    const s = el.getAttribute("data-line-start");
    if (s) {
      const start = parseInt(s, 10);
      const end = parseInt(el.getAttribute("data-line-end") ?? s, 10);
      return { start, end };
    }
    el = el.parentElement;
  }
  return null;
}

export default function MarkdownViewer({ content, filePath }: MarkdownViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<{ start: number; end: number } | null>(null);
  const addCommentToStore = useStore((s) => s.addComment);
  const activeHighlight = useStore((s) => s.activeHighlight);
  const bumpCenterReload = useStore((s) => s.bumpCenterReload);
  const openFile = useStore((s) => s.openFile);
  const markdownHashTarget = useStore((s) => s.markdownHashTarget);
  const setMarkdownHashTarget = useStore((s) => s.setMarkdownHashTarget);
  const [show_mermaid_source, set_show_mermaid_source] = useState(false);
  const has_mermaid_blocks = /^```mermaid\b/m.test(content);
  const normalized_content = normalize_github_math_markdown(content);

  useEffect(() => {
    set_show_mermaid_source(false);
  }, [filePath]);

  const scrollToHash = useCallback((hash: string) => {
    const id = decodeURIComponent(hash.replace(/^#/, ""));
    if (!id) {
      return false;
    }
    const target = document.getElementById(id) as HTMLElement | null;
    if (!target || !containerRef.current?.contains(target)) {
      return false;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("markdown-monaco-jump-highlight");
    window.setTimeout(() => target.classList.remove("markdown-monaco-jump-highlight"), 2000);
    return true;
  }, []);

  useLayoutEffect(() => {
    if (!markdownHashTarget || markdownHashTarget.path !== filePath || !markdownHashTarget.hash) {
      return;
    }
    if (scrollToHash(markdownHashTarget.hash)) {
      setMarkdownHashTarget(null);
    }
  }, [markdownHashTarget, filePath, content, scrollToHash, setMarkdownHashTarget]);

  // Scroll / highlight when activeHighlight or rendered markdown changes.
  // useLayoutEffect so DOM from ReactMarkdown is present (mirrors CodeViewer onMount fix).
  useLayoutEffect(() => {
    if (!activeHighlight || activeHighlight.path !== filePath) {
      return;
    }
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const target = container.querySelector(
      `[data-line-start="${activeHighlight.line_start}"]`,
    ) as HTMLElement | null;
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("markdown-monaco-jump-highlight");
      setTimeout(() => target.classList.remove("markdown-monaco-jump-highlight"), 2000);
    }
  }, [activeHighlight, filePath, content, show_mermaid_source]);

  const handleMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      selectionRef.current = null;
      return;
    }
    const anchor = findLineAttr(sel.anchorNode);
    const focus = findLineAttr(sel.focusNode);
    if (!anchor || !focus) return;
    const start = Math.min(anchor.start, focus.start);
    const end = Math.max(anchor.end, focus.end);
    selectionRef.current = { start, end };
  }, []);

  const handleAdd = useCallback(async (overrideSel?: { start: number; end: number }) => {
    const sel = overrideSel ?? selectionRef.current;
    if (!sel) return;
    const highlighted_text = window.getSelection()?.toString() ?? "";
    window.getSelection()?.removeAllRanges();
    selectionRef.current = null;
    try {
      const comment = await createComment(filePath, sel.start, sel.end, "", highlighted_text);
      addCommentToStore(comment);
    } catch (e) {
      console.error("Failed to create comment:", e);
    }
  }, [filePath, addCommentToStore]);

  // Ctrl+Alt+C shortcut — read live selection at keydown time
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key === "c") {
        e.preventDefault();
        // Read selection now, before any browser-side clearing
        const winSel = window.getSelection();
        if (winSel && !winSel.isCollapsed) {
          const anchor = findLineAttr(winSel.anchorNode);
          const focus = findLineAttr(winSel.focusNode);
          if (anchor && focus) {
            const start = Math.min(anchor.start, focus.start);
            const end = Math.max(anchor.end, focus.end);
            handleAdd({ start, end });
            return;
          }
        }
        // Fall back to whatever mouseup recorded
        handleAdd();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleAdd]);

  const components = makeComponents(
    filePath,
    openFile,
    scrollToHash,
    setMarkdownHashTarget,
    show_mermaid_source,
  );

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar — matches CodeViewer */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700 shrink-0 gap-2">
        <span className="text-xs text-gray-400 font-mono truncate min-w-0">{filePath}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => bumpCenterReload()}
            aria-label="Reload: fetch the latest file content from disk"
            title="Reload from disk (after the file changes on disk)"
            className={toolbarBtnNeutral}
          >
            <IconRefresh className={toolbarIconClass} />
            <span>Reload</span>
          </button>
          {has_mermaid_blocks ? (
            <button
              type="button"
              onClick={() => set_show_mermaid_source((value) => !value)}
              aria-label={show_mermaid_source ? "Show rendered Mermaid diagrams" : "Show Mermaid source code"}
              title={show_mermaid_source ? "Switch Mermaid blocks to rendered diagrams" : "Switch Mermaid blocks to source code"}
              className={show_mermaid_source ? toolbarBtnPrimary : toolbarBtnNeutral}
            >
              <span>Mermaid: {show_mermaid_source ? "Source" : "Rendered"}</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => handleAdd()}
            aria-label="Add comment from current text selection (Ctrl+Alt+C)"
            title="Add Comment (Ctrl+Alt+C)"
            className={toolbarBtnPrimary}
          >
            <IconPlus className={toolbarIconClass} />
            <span>Add (Ctrl+Alt+C)</span>
          </button>
        </div>
      </div>

      {/* Scrollable markdown body — colors match Monaco vs-dark (see index.css) */}
      <div
        ref={containerRef}
        className="markdown-monaco-surface monaco-like-scrollbar flex-1 overflow-y-auto px-8 py-6 text-[13px] leading-normal"
        onMouseUp={handleMouseUp}
      >
        <div className="prose prose-invert max-w-none">
          <ReactMarkdown
            remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: false }]]}
            rehypePlugins={[rehypeKatex, rehypeSlug]}
            components={components}
          >
            {normalized_content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
