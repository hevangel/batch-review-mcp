import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import html2canvas from "html2canvas";
import { parse, serialize, type DefaultTreeAdapterMap } from "parse5";
import { useStore } from "../../store";
import { createComment, uploadRegionScreenshot } from "../../api";
import { IconPlus, IconRefresh, toolbarBtnNeutral, toolbarBtnPrimary, toolbarIconClass } from "../ui/toolbarIcons";

interface HtmlViewerProps {
  content: string;
  filePath: string;
}

type ParseNode = DefaultTreeAdapterMap["node"];
type ElementNode = DefaultTreeAdapterMap["element"];
type SourceLocation = NonNullable<ElementNode["sourceCodeLocation"]>;

interface NormRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface HtmlSelectionAnchor {
  kind: "html_element" | "html_text" | "html_region";
  line_start: number;
  line_end: number;
  highlighted_text: string;
  html_selector?: string;
  html_fingerprint?: string;
  region?: NormRect;
}

interface LiveRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const ANCHOR_ATTR = "data-br-html-anchor";
const HOVER_CLASS = "batch-review-html-hover";
const SELECTED_CLASS = "batch-review-html-selected";
const JUMP_CLASS = "batch-review-html-jump-highlight";
const REGION_CLASS = "batch-review-html-region-highlight";

function hasChildNodes(node: ParseNode): node is ParseNode & { childNodes: ParseNode[] } {
  return Array.isArray((node as { childNodes?: ParseNode[] }).childNodes);
}

function isElementNode(node: ParseNode): node is ElementNode {
  const maybe = node as Partial<ElementNode>;
  return typeof maybe.tagName === "string" && Array.isArray(maybe.attrs);
}

function getAttr(node: ElementNode, name: string): string | null {
  return node.attrs.find((attr) => attr.name === name)?.value ?? null;
}

function setAttr(node: ElementNode, name: string, value: string): void {
  const attr = node.attrs.find((item) => item.name === name);
  if (attr) {
    attr.value = value;
    return;
  }
  node.attrs.push({ name, value });
}

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

function hashString(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function sourceSnippet(content: string, line_start: number, line_end: number): string {
  if (line_start < 1 || line_end < line_start) {
    return "";
  }
  return content.split(/\r?\n/).slice(line_start - 1, line_end).join("\n");
}

function sourceSlice(content: string, location: SourceLocation): string {
  if (location.startOffset == null || location.endOffset == null) {
    return sourceSnippet(content, location.startLine, location.endLine);
  }
  return content.slice(location.startOffset, location.endOffset);
}

function buildSelector(node: ElementNode, parentSelector: string, nthOfType: number): string {
  const tag = node.tagName.toLowerCase();
  const id = getAttr(node, "id");
  if (id) {
    return `${tag}#${cssEscape(id)}`;
  }
  const segment = `${tag}:nth-of-type(${nthOfType})`;
  return parentSelector ? `${parentSelector} > ${segment}` : segment;
}

function annotateChildren(node: ParseNode, content: string, parentSelector: string): void {
  if (!hasChildNodes(node)) {
    return;
  }
  const tagCounts = new Map<string, number>();
  for (const child of node.childNodes) {
    if (!isElementNode(child)) {
      annotateChildren(child, content, parentSelector);
      continue;
    }

    const tag = child.tagName.toLowerCase();
    const nthOfType = (tagCounts.get(tag) ?? 0) + 1;
    tagCounts.set(tag, nthOfType);
    const selector = buildSelector(child, parentSelector, nthOfType);
    rewriteRootRelativeAsset(child, "href");
    rewriteRootRelativeAsset(child, "src");
    rewriteRootRelativeAsset(child, "poster");
    const location = child.sourceCodeLocation;
    if (location?.startLine != null && location.endLine != null) {
      const slice = sourceSlice(content, location);
      setAttr(child, ANCHOR_ATTR, "true");
      setAttr(child, "data-line-start", String(location.startLine));
      setAttr(child, "data-line-end", String(location.endLine));
      setAttr(child, "data-html-selector", selector);
      setAttr(child, "data-html-fingerprint", `${tag}:${location.startLine}-${location.endLine}:${hashString(slice)}`);
    }
    annotateChildren(child, content, selector);
  }
}

function encodeRepoPath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function rawContentBaseForFile(filePath: string): string {
  const slash = filePath.lastIndexOf("/");
  const dir = slash >= 0 ? filePath.slice(0, slash) : "";
  const encoded = encodeRepoPath(dir);
  return encoded ? `/api/raw-content/${encoded}/` : "/api/raw-content/";
}

function rawContentUrlForRootPath(value: string): string {
  return `/api/raw-content/${encodeRepoPath(value.replace(/^\/+/, ""))}`;
}

function rewriteRootRelativeAsset(node: ElementNode, attrName: string): void {
  const value = getAttr(node, attrName);
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return;
  }
  setAttr(node, attrName, rawContentUrlForRootPath(value));
}

function previewScaffold(baseHref: string): string {
  return [
    `<base href="${htmlEscape(baseHref)}">`,
    `<style>
      [${ANCHOR_ATTR}] {
        outline-offset: 2px !important;
      }
      .${HOVER_CLASS} {
        outline: 2px dashed #60a5fa !important;
        cursor: crosshair !important;
      }
      .${SELECTED_CLASS} {
        outline: 2px solid #3b82f6 !important;
        background-color: rgba(59, 130, 246, 0.08) !important;
      }
      .${JUMP_CLASS} {
        outline: 3px solid #eab308 !important;
        background-color: rgba(234, 179, 8, 0.18) !important;
      }
      .${REGION_CLASS} {
        position: absolute !important;
        z-index: 2147483647 !important;
        pointer-events: none !important;
        border: 3px solid #eab308 !important;
        background: rgba(234, 179, 8, 0.22) !important;
        box-sizing: border-box !important;
      }
    </style>`,
  ].join("");
}

function injectScaffold(html: string, baseHref: string): string {
  const scaffold = previewScaffold(baseHref);
  if (/<head(?:\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}${scaffold}`);
  }
  return `${scaffold}${html}`;
}

function buildAnnotatedHtml(content: string, filePath: string): string {
  const documentNode = parse(content, { sourceCodeLocationInfo: true });
  annotateChildren(documentNode as ParseNode, content, "");
  return injectScaffold(serialize(documentNode), rawContentBaseForFile(filePath));
}

function nodeElement(target: EventTarget | Node | null): HTMLElement | null {
  const node = target as Node | null;
  if (!node) {
    return null;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    return node as HTMLElement;
  }
  return node.parentElement;
}

function closestAnchorElement(target: EventTarget | Node | null): HTMLElement | null {
  return nodeElement(target)?.closest(`[${ANCHOR_ATTR}]`) as HTMLElement | null;
}

function removeClass(doc: Document, className: string): void {
  doc.querySelectorAll(`.${className}`).forEach((el) => el.classList.remove(className));
}

function clearRegionHighlights(doc: Document): void {
  doc.querySelectorAll(`.${REGION_CLASS}`).forEach((el) => el.remove());
}

function readLineAnchorFromElement(el: HTMLElement, content: string): HtmlSelectionAnchor | null {
  const start = Number.parseInt(el.dataset.lineStart ?? "", 10);
  const end = Number.parseInt(el.dataset.lineEnd ?? "", 10);
  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return null;
  }
  return {
    kind: "html_element",
    line_start: start,
    line_end: end,
    highlighted_text: sourceSnippet(content, start, end),
    html_selector: el.dataset.htmlSelector,
    html_fingerprint: el.dataset.htmlFingerprint,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizedDocSize(doc: Document): { width: number; height: number } {
  const root = doc.documentElement;
  const body = doc.body;
  return {
    width: Math.max(root.scrollWidth, body?.scrollWidth ?? 0, root.clientWidth, 1),
    height: Math.max(root.scrollHeight, body?.scrollHeight ?? 0, root.clientHeight, 1),
  };
}

function selectorForHighlight(doc: Document, selector?: string | null): HTMLElement | null {
  if (!selector) {
    return null;
  }
  try {
    return doc.querySelector(selector) as HTMLElement | null;
  } catch {
    return null;
  }
}

export default function HtmlViewer({ content, filePath }: HtmlViewerProps) {
  const addCommentToStore = useStore((s) => s.addComment);
  const activeHighlight = useStore((s) => s.activeHighlight);
  const bumpCenterReload = useStore((s) => s.bumpCenterReload);
  const theme = useStore((s) => s.theme);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const hoveredRef = useRef<HTMLElement | null>(null);
  const drawingRef = useRef<{ startX: number; startY: number } | null>(null);
  const regionModeRef = useRef(false);
  const selectedAnchorRef = useRef<HtmlSelectionAnchor | null>(null);

  const [viewMode, setViewMode] = useState<"preview" | "source">("preview");
  const [regionMode, setRegionMode] = useState(false);
  const [selectedAnchor, setSelectedAnchor] = useState<HtmlSelectionAnchor | null>(null);
  const [liveRect, setLiveRect] = useState<LiveRect | null>(null);
  const [drawnRect, setDrawnRect] = useState<LiveRect | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);

  const annotatedHtml = useMemo(() => buildAnnotatedHtml(content, filePath), [content, filePath]);

  const captureRegionScreenshot = useCallback(async (anchor: HtmlSelectionAnchor) => {
    if (anchor.kind !== "html_region" || !anchor.region) {
      return null;
    }
    const doc = iframeRef.current?.contentDocument;
    if (!doc?.documentElement) {
      throw new Error("HTML preview is not ready for screenshot capture.");
    }

    const { width, height } = normalizedDocSize(doc);
    if (width <= 0 || height <= 0) {
      throw new Error("HTML preview has no measurable size to capture.");
    }

    const canvas = await html2canvas(doc.documentElement, {
      backgroundColor: null,
      useCORS: true,
      allowTaint: false,
      logging: false,
      scrollX: 0,
      scrollY: 0,
      windowWidth: width,
      windowHeight: height,
    });
    const scaleX = canvas.width / width;
    const scaleY = canvas.height / height;
    const cropX = Math.max(0, Math.floor(anchor.region.x1 * width * scaleX));
    const cropY = Math.max(0, Math.floor(anchor.region.y1 * height * scaleY));
    const cropW = Math.max(1, Math.ceil((anchor.region.x2 - anchor.region.x1) * width * scaleX));
    const cropH = Math.max(1, Math.ceil((anchor.region.y2 - anchor.region.y1) * height * scaleY));
    const cropCanvas = document.createElement("canvas");
    cropCanvas.width = Math.max(1, Math.min(cropW, canvas.width - cropX));
    cropCanvas.height = Math.max(1, Math.min(cropH, canvas.height - cropY));
    const ctx = cropCanvas.getContext("2d");
    if (!ctx) {
      throw new Error("Cannot create screenshot canvas.");
    }
    ctx.drawImage(canvas, cropX, cropY, cropCanvas.width, cropCanvas.height, 0, 0, cropCanvas.width, cropCanvas.height);
    const blob = await new Promise<Blob | null>((resolve) => cropCanvas.toBlob(resolve, "image/png"));
    if (!blob) {
      throw new Error("Cannot encode region screenshot.");
    }
    return { blob, width: cropCanvas.width, height: cropCanvas.height };
  }, []);

  useEffect(() => {
    regionModeRef.current = regionMode;
  }, [regionMode]);

  useEffect(() => {
    selectedAnchorRef.current = selectedAnchor;
  }, [selectedAnchor]);

  useEffect(() => {
    setSelectedAnchor(null);
    setLiveRect(null);
    setDrawnRect(null);
    setRegionMode(false);
  }, [content, filePath]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
    };
  }, []);

  const captureTextSelection = useCallback((win: Window): HtmlSelectionAnchor | null => {
    const sel = win.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
      return null;
    }
    const anchor = closestAnchorElement(sel.anchorNode);
    const focus = closestAnchorElement(sel.focusNode);
    if (!anchor || !focus) {
      return null;
    }
    const start = Math.min(
      Number.parseInt(anchor.dataset.lineStart ?? "", 10),
      Number.parseInt(focus.dataset.lineStart ?? "", 10),
    );
    const end = Math.max(
      Number.parseInt(anchor.dataset.lineEnd ?? "", 10),
      Number.parseInt(focus.dataset.lineEnd ?? "", 10),
    );
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      return null;
    }
    const range = sel.getRangeAt(0);
    const common = closestAnchorElement(range.commonAncestorContainer);
    const text = sel.toString();
    if (!text.trim()) {
      return null;
    }
    return {
      kind: "html_text",
      line_start: start,
      line_end: end,
      highlighted_text: text,
      html_selector: common?.dataset.htmlSelector ?? anchor.dataset.htmlSelector,
      html_fingerprint: common?.dataset.htmlFingerprint ?? anchor.dataset.htmlFingerprint,
    };
  }, []);

  const addComment = useCallback(
    async (overrideAnchor?: HtmlSelectionAnchor | null) => {
      const anchor = overrideAnchor ?? selectedAnchorRef.current;
      if (!anchor) {
        return;
      }
      try {
        setCaptureError(null);
        const screenshot = await captureRegionScreenshot(anchor);
        const comment = await createComment(
          filePath,
          anchor.kind === "html_region" ? 0 : anchor.line_start,
          anchor.kind === "html_region" ? 0 : anchor.line_end,
          "",
          anchor.highlighted_text,
          anchor.region,
          undefined,
          {
            anchor_kind: anchor.kind,
            html_selector: anchor.html_selector,
            html_fingerprint: anchor.html_fingerprint,
          },
        );
        if (screenshot) {
          const withScreenshot = await uploadRegionScreenshot(
            comment.id,
            screenshot.blob,
            screenshot.width,
            screenshot.height,
          );
          addCommentToStore(withScreenshot);
        } else {
          addCommentToStore(comment);
        }
        iframeRef.current?.contentWindow?.getSelection()?.removeAllRanges();
        setSelectedAnchor(null);
        setDrawnRect(null);
      } catch (err) {
        console.error("Failed to create HTML comment:", err);
        setCaptureError(err instanceof Error ? err.message : String(err));
      }
    },
    [addCommentToStore, captureRegionScreenshot, filePath],
  );

  const installIframeHandlers = useCallback(() => {
    cleanupRef.current?.();
    cleanupRef.current = null;

    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    const win = iframe?.contentWindow;
    if (!iframe || !doc || !win) {
      return;
    }

    const setHovered = (el: HTMLElement | null) => {
      if (hoveredRef.current === el) {
        return;
      }
      hoveredRef.current?.classList.remove(HOVER_CLASS);
      hoveredRef.current = el;
      if (el && !regionModeRef.current) {
        el.classList.add(HOVER_CLASS);
      }
    };

    const onMouseOver = (event: MouseEvent) => {
      if (regionModeRef.current) {
        setHovered(null);
        return;
      }
      setHovered(closestAnchorElement(event.target));
    };

    const onMouseOut = (event: MouseEvent) => {
      const next = nodeElement(event.relatedTarget);
      if (!next || !next.closest(`[${ANCHOR_ATTR}]`)) {
        setHovered(null);
      }
    };

    const onMouseUp = () => {
      if (regionModeRef.current) {
        return;
      }
      const textAnchor = captureTextSelection(win);
      if (textAnchor) {
        removeClass(doc, SELECTED_CLASS);
        setSelectedAnchor(textAnchor);
      }
    };

    const onClick = (event: MouseEvent) => {
      const clickedLink = nodeElement(event.target)?.closest("a");
      if (clickedLink) {
        event.preventDefault();
      }
      if (regionModeRef.current) {
        return;
      }
      const textAnchor = captureTextSelection(win);
      const elementAnchor = closestAnchorElement(event.target);
      const nextAnchor = textAnchor ?? (elementAnchor ? readLineAnchorFromElement(elementAnchor, content) : null);
      if (!nextAnchor) {
        return;
      }
      removeClass(doc, SELECTED_CLASS);
      if (elementAnchor && nextAnchor.kind === "html_element") {
        elementAnchor.classList.add(SELECTED_CLASS);
      }
      setSelectedAnchor(nextAnchor);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        const textAnchor = captureTextSelection(win);
        if (textAnchor) {
          setSelectedAnchor(textAnchor);
          void addComment(textAnchor);
          return;
        }
        void addComment();
      }
    };

    doc.addEventListener("mouseover", onMouseOver, true);
    doc.addEventListener("mouseout", onMouseOut, true);
    doc.addEventListener("mouseup", onMouseUp, true);
    doc.addEventListener("click", onClick, true);
    doc.addEventListener("keydown", onKeyDown, true);
    cleanupRef.current = () => {
      doc.removeEventListener("mouseover", onMouseOver, true);
      doc.removeEventListener("mouseout", onMouseOut, true);
      doc.removeEventListener("mouseup", onMouseUp, true);
      doc.removeEventListener("click", onClick, true);
      doc.removeEventListener("keydown", onKeyDown, true);
    };
  }, [addComment, captureTextSelection, content]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.key.toLowerCase() === "c") {
        event.preventDefault();
        void addComment();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [addComment]);

  useEffect(() => {
    if (activeHighlight?.path === filePath && activeHighlight.anchor_kind?.startsWith("html")) {
      setViewMode("preview");
    }
  }, [activeHighlight, filePath]);

  useEffect(() => {
    if (viewMode !== "preview" || !activeHighlight || activeHighlight.path !== filePath) {
      return;
    }

    let cancelled = false;
    let retryTimer: number | null = null;
    let clearTimer: number | null = null;
    let attempts = 0;

    const applyHighlight = () => {
      if (cancelled) {
        return;
      }
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      if (!iframe || !doc) {
        if (attempts++ < 20) {
          retryTimer = window.setTimeout(applyHighlight, 100);
        }
        return;
      }

      removeClass(doc, JUMP_CLASS);
      clearRegionHighlights(doc);

      if (activeHighlight.anchor_kind === "html_region" && activeHighlight.region_x1 != null) {
        const { width, height } = normalizedDocSize(doc);
        const box = doc.createElement("div");
        box.className = REGION_CLASS;
        box.style.left = `${activeHighlight.region_x1 * width}px`;
        box.style.top = `${(activeHighlight.region_y1 ?? 0) * height}px`;
        box.style.width = `${((activeHighlight.region_x2 ?? activeHighlight.region_x1) - activeHighlight.region_x1) * width}px`;
        box.style.height = `${((activeHighlight.region_y2 ?? activeHighlight.region_y1 ?? 0) - (activeHighlight.region_y1 ?? 0)) * height}px`;
        doc.body.appendChild(box);
        box.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
        clearTimer = window.setTimeout(() => box.remove(), 3500);
        return;
      }

      const selectorTarget = selectorForHighlight(doc, activeHighlight.html_selector);
      const lineTarget = doc.querySelector(
        `[data-line-start="${activeHighlight.line_start}"]`,
      ) as HTMLElement | null;
      const target = selectorTarget ?? lineTarget;
      if (!target) {
        if (attempts++ < 20) {
          retryTimer = window.setTimeout(applyHighlight, 100);
        }
        return;
      }
      target.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      target.classList.add(JUMP_CLASS);
      clearTimer = window.setTimeout(() => target.classList.remove(JUMP_CLASS), 3500);
    };

    applyHighlight();
    return () => {
      cancelled = true;
      if (retryTimer != null) {
        window.clearTimeout(retryTimer);
      }
      if (clearTimer != null) {
        window.clearTimeout(clearTimer);
      }
    };
  }, [activeHighlight, annotatedHtml, filePath, viewMode]);

  const beginRegion = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!regionMode || event.button !== 0) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    drawingRef.current = { startX: x, startY: y };
    setLiveRect({ x1: x, y1: y, x2: x, y2: y });
    setDrawnRect(null);
    setSelectedAnchor(null);
  };

  const updateRegion = (event: React.MouseEvent<HTMLDivElement>) => {
    const drawing = drawingRef.current;
    if (!drawing) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setLiveRect({
      x1: drawing.startX,
      y1: drawing.startY,
      x2: event.clientX - rect.left,
      y2: event.clientY - rect.top,
    });
  };

  const finishRegion = (event: React.MouseEvent<HTMLDivElement>) => {
    const drawing = drawingRef.current;
    if (!drawing) {
      return;
    }
    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    const win = iframe?.contentWindow;
    drawingRef.current = null;
    setLiveRect(null);
    if (!doc || !win) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const endX = event.clientX - rect.left;
    const endY = event.clientY - rect.top;
    if (Math.abs(endX - drawing.startX) <= 4 || Math.abs(endY - drawing.startY) <= 4) {
      return;
    }
    const { width, height } = normalizedDocSize(doc);
    const x1 = clamp01((Math.min(drawing.startX, endX) + win.scrollX) / width);
    const y1 = clamp01((Math.min(drawing.startY, endY) + win.scrollY) / height);
    const x2 = clamp01((Math.max(drawing.startX, endX) + win.scrollX) / width);
    const y2 = clamp01((Math.max(drawing.startY, endY) + win.scrollY) / height);
    setDrawnRect({
      x1: Math.min(drawing.startX, endX),
      y1: Math.min(drawing.startY, endY),
      x2: Math.max(drawing.startX, endX),
      y2: Math.max(drawing.startY, endY),
    });
    setSelectedAnchor({
      kind: "html_region",
      line_start: 0,
      line_end: 0,
      highlighted_text: "",
      region: { x1, y1, x2, y2 },
      html_fingerprint: `viewport:${hashString(`${x1},${y1},${x2},${y2}`)}`,
    });
  };

  const visibleRect = liveRect ?? drawnRect;
  const normalizedVisibleRect = visibleRect
    ? {
        x: Math.min(visibleRect.x1, visibleRect.x2),
        y: Math.min(visibleRect.y1, visibleRect.y2),
        w: Math.abs(visibleRect.x2 - visibleRect.x1),
        h: Math.abs(visibleRect.y2 - visibleRect.y1),
      }
    : null;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700 shrink-0 gap-2 flex-wrap">
        <span className="text-xs text-gray-400 font-mono truncate min-w-0 flex-1">{filePath}</span>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => {
              if (viewMode !== "preview") {
                return;
              }
              setRegionMode((value) => !value);
              setLiveRect(null);
              setDrawnRect(null);
              setSelectedAnchor(null);
            }}
            disabled={viewMode !== "preview"}
            className={`${regionMode ? toolbarBtnPrimary : toolbarBtnNeutral} w-20 justify-center`}
            title={
              viewMode !== "preview"
                ? "Switch to Preview before drawing a visual region"
                : regionMode
                ? "Switch to element/text selection"
                : "Draw a visual region on the rendered page"
            }
          >
            <span>{regionMode ? "Region on" : "Region"}</span>
          </button>
          <div className="inline-flex overflow-hidden rounded border border-gray-600">
            <button
              type="button"
              onClick={() => setViewMode("preview")}
              className={`${viewMode === "preview" ? toolbarBtnPrimary : toolbarBtnNeutral} rounded-none border-0`}
              title="Show rendered HTML preview"
              aria-pressed={viewMode === "preview"}
            >
              <span>Preview</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode("source")}
              className={`${viewMode === "source" ? toolbarBtnPrimary : toolbarBtnNeutral} rounded-none border-0`}
              title="Show HTML source"
              aria-pressed={viewMode === "source"}
            >
              <span>Source</span>
            </button>
          </div>
          <button
            type="button"
            onClick={() => bumpCenterReload()}
            aria-label="Reload HTML from disk"
            title="Reload HTML from disk"
            className={toolbarBtnNeutral}
          >
            <IconRefresh className={toolbarIconClass} />
            <span>Reload</span>
          </button>
          <button
            type="button"
            onClick={() => void addComment()}
            disabled={!selectedAnchor}
            aria-label="Add HTML comment (Ctrl+Alt+C)"
            title={
              regionMode
                ? "Add Comment (Ctrl+Alt+C) for drawn region"
                : "Add Comment (Ctrl+Alt+C) for selected element or text"
            }
            className={toolbarBtnPrimary}
          >
            <IconPlus className={toolbarIconClass} />
            <span>Add (Ctrl+Alt+C)</span>
          </button>
        </div>
        {captureError ? (
          <div className="basis-full text-xs text-red-400">{captureError}</div>
        ) : null}
      </div>

      {viewMode === "source" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <Editor
            height="100%"
            language="html"
            value={content}
            theme={theme === "dark" ? "vs-dark" : "vs"}
            options={{
              readOnly: true,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              fontSize: 13,
              lineNumbers: "on",
              wordWrap: "off",
              renderLineHighlight: "line",
              selectionHighlight: true,
              occurrencesHighlight: "off",
            }}
          />
        </div>
      ) : (
        <div className="relative flex-1 min-h-0 bg-gray-900">
          <iframe
            ref={iframeRef}
            title={`HTML preview: ${filePath}`}
            sandbox="allow-same-origin"
            srcDoc={annotatedHtml}
            onLoad={installIframeHandlers}
            className="h-full w-full border-0 bg-white"
          />
          {regionMode && (
            <div
              className="absolute inset-0 z-10 cursor-crosshair"
              onMouseDown={beginRegion}
              onMouseMove={updateRegion}
              onMouseUp={finishRegion}
              onMouseLeave={finishRegion}
            >
              {normalizedVisibleRect && (
                <svg className="pointer-events-none absolute inset-0 h-full w-full">
                  <rect
                    x={normalizedVisibleRect.x}
                    y={normalizedVisibleRect.y}
                    width={normalizedVisibleRect.w}
                    height={normalizedVisibleRect.h}
                    fill={liveRect ? "rgba(59,130,246,0.15)" : "rgba(59,130,246,0.2)"}
                    stroke="#3b82f6"
                    strokeWidth={2}
                    strokeDasharray={liveRect ? "6 3" : undefined}
                  />
                </svg>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
