import { useCallback, useEffect, useRef, useState } from "react";
import { Document, Page, pdfjs } from "react-pdf";
import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { useStore } from "../../store";
import { createComment, pdfUrl } from "../../api";
import { IconPlus, IconRefresh, toolbarBtnNeutral, toolbarBtnPrimary, toolbarIconClass } from "../ui/toolbarIcons";

// Keep the worker on the same pdfjs-dist version that react-pdf expects.
pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

interface PdfViewerProps {
  filePath: string;
  cacheBust?: number;
}

interface NormRect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface TextChunk {
  node: Text;
  start: number;
  end: number;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function normalizeRect(x1: number, y1: number, x2: number, y2: number, w: number, h: number): NormRect {
  if (w <= 0 || h <= 0) {
    return { x1: 0, y1: 0, x2: 0, y2: 0 };
  }
  const nx1 = clamp01(Math.min(x1, x2) / w);
  const ny1 = clamp01(Math.min(y1, y2) / h);
  const nx2 = clamp01(Math.max(x1, x2) / w);
  const ny2 = clamp01(Math.max(y1, y2) / h);
  return { x1: nx1, y1: ny1, x2: nx2, y2: ny2 };
}

function normalizeSearchText(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function buildNormalizedIndex(raw: string): { text: string; rawByNormalized: number[] } {
  let text = "";
  const rawByNormalized: number[] = [];
  let sawNonSpace = false;
  let pendingSpace = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (/\s/.test(ch)) {
      if (sawNonSpace) {
        pendingSpace = true;
      }
      continue;
    }
    if (pendingSpace && text.length > 0) {
      text += " ";
      rawByNormalized.push(i);
      pendingSpace = false;
    }
    text += ch;
    rawByNormalized.push(i);
    sawNonSpace = true;
  }

  return { text, rawByNormalized };
}

function collectTextChunks(root: HTMLElement): { chunks: TextChunk[]; text: string } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const chunks: TextChunk[] = [];
  let text = "";
  let current = walker.nextNode();

  while (current) {
    const node = current as Text;
    const value = node.data ?? "";
    if (value.length > 0) {
      const start = text.length;
      text += value;
      chunks.push({ node, start, end: text.length });
    }
    current = walker.nextNode();
  }

  return { chunks, text };
}

function locateTextOffset(chunks: TextChunk[], rawOffset: number): { node: Text; offset: number } | null {
  for (const chunk of chunks) {
    if (rawOffset >= chunk.start && rawOffset < chunk.end) {
      return { node: chunk.node, offset: rawOffset - chunk.start };
    }
    if (rawOffset === chunk.end) {
      return { node: chunk.node, offset: chunk.node.data.length };
    }
  }
  const last = chunks[chunks.length - 1];
  if (last && rawOffset === last.end) {
    return { node: last.node, offset: last.node.data.length };
  }
  return null;
}

function findTextRange(root: HTMLElement, query: string): Range | null {
  const needle = normalizeSearchText(query);
  if (!needle) {
    return null;
  }

  const { chunks, text } = collectTextChunks(root);
  if (chunks.length === 0 || !text) {
    return null;
  }

  const normalized = buildNormalizedIndex(text);
  const startIdx = normalized.text.indexOf(needle);
  if (startIdx < 0) {
    return null;
  }

  const rawStart = normalized.rawByNormalized[startIdx];
  const rawEnd = normalized.rawByNormalized[startIdx + needle.length - 1] + 1;
  const startLoc = locateTextOffset(chunks, rawStart);
  const endLoc = locateTextOffset(chunks, rawEnd);
  if (!startLoc || !endLoc) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startLoc.node, startLoc.offset);
  range.setEnd(endLoc.node, endLoc.offset);
  return range;
}

function rangeToNormRects(range: Range, pageEl: HTMLElement): NormRect[] {
  const prect = pageEl.getBoundingClientRect();
  if (prect.width <= 0 || prect.height <= 0) {
    return [];
  }
  return Array.from(range.getClientRects())
    .filter((r) => r.width >= 1 || r.height >= 1)
    .map((r) =>
      normalizeRect(
        r.left - prect.left,
        r.top - prect.top,
        r.right - prect.left,
        r.bottom - prect.top,
        prect.width,
        prect.height,
      ),
    );
}

function findPageWrap(start: Node | null): { page: number; el: HTMLElement } | null {
  let n: Node | null = start;
  while (n && n !== document.body) {
    if (n instanceof HTMLElement) {
      const p = n.dataset.pdfPage;
      if (p != null) {
        const num = parseInt(p, 10);
        if (!Number.isNaN(num)) {
          return { page: num, el: n };
        }
      }
    }
    n = n.parentNode;
  }
  return null;
}

function selectionToNormRect(sel: Selection, pageEl: HTMLElement): NormRect | null {
  if (sel.rangeCount === 0 || sel.isCollapsed) {
    return null;
  }
  const prect = pageEl.getBoundingClientRect();
  if (prect.width < 2 || prect.height < 2) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < sel.rangeCount; i++) {
    const range = sel.getRangeAt(i);
    for (const r of range.getClientRects()) {
      if (r.width < 1 && r.height < 1) {
        continue;
      }
      minX = Math.min(minX, r.left - prect.left);
      minY = Math.min(minY, r.top - prect.top);
      maxX = Math.max(maxX, r.right - prect.left);
      maxY = Math.max(maxY, r.bottom - prect.top);
    }
  }
  if (!Number.isFinite(minX) || maxX <= minX || maxY <= minY) {
    return null;
  }
  return normalizeRect(minX, minY, maxX, maxY, prect.width, prect.height);
}

interface LiveDraw {
  page: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface PdfTextSelection {
  page: number;
  text: string;
}

export default function PdfViewer({ filePath, cacheBust }: PdfViewerProps) {
  const addCommentToStore = useStore((s) => s.addComment);
  const pdfRegion = useStore((s) => s.pdfRegion);
  const setPdfRegion = useStore((s) => s.setPdfRegion);
  const activeHighlight = useStore((s) => s.activeHighlight);
  const bumpCenterReload = useStore((s) => s.bumpCenterReload);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [pageWidth, setPageWidth] = useState(720);
  const [pageHeights, setPageHeights] = useState<Record<number, number>>({});
  const [regionMode, setRegionMode] = useState(false);
  const [drawnNorm, setDrawnNorm] = useState<{ page: number; rect: NormRect } | null>(null);
  const [highlightDisp, setHighlightDisp] = useState<{ page: number; rects: NormRect[] } | null>(null);
  const [liveDraw, setLiveDraw] = useState<LiveDraw | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const drawing = useRef<{ page: number; startX: number; startY: number; w: number; h: number } | null>(null);
  const selectionRef = useRef<PdfTextSelection | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) {
      return;
    }
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth - 32;
      setPageWidth(Math.max(240, Math.min(920, w)));
    });
    ro.observe(el);
    const w0 = el.clientWidth - 32;
    setPageWidth(Math.max(240, Math.min(920, w0)));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    setDrawnNorm(null);
    setPdfRegion(null);
    setHighlightDisp(null);
    setLiveDraw(null);
    setLoadError(null);
    setRegionMode(false);
    setPageHeights({});
    selectionRef.current = null;
  }, [filePath, setPdfRegion]);

  const captureTextSelection = useCallback((): PdfTextSelection | null => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      selectionRef.current = null;
      return null;
    }
    const anchor = findPageWrap(sel.anchorNode);
    const focus = findPageWrap(sel.focusNode);
    if (!anchor || !focus || anchor.page !== focus.page) {
      selectionRef.current = null;
      return null;
    }
    const text = sel.toString();
    if (!normalizeSearchText(text)) {
      selectionRef.current = null;
      return null;
    }
    const captured = { page: anchor.page, text };
    selectionRef.current = captured;
    return captured;
  }, []);

  const onMouseDownRegion = useCallback(
    (pageNum: number, w: number, h: number, e: React.MouseEvent) => {
      if (e.button !== 0) {
        return;
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      drawing.current = { page: pageNum, startX: x, startY: y, w, h };
      setLiveDraw({ page: pageNum, x1: x, y1: y, x2: x, y2: y });
      setPdfRegion(null);
      setDrawnNorm(null);
    },
    [setPdfRegion],
  );

  const onMouseMoveRegion = useCallback((e: React.MouseEvent) => {
    const d = drawing.current;
    if (!d) {
      return;
    }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setLiveDraw({ page: d.page, x1: d.startX, y1: d.startY, x2: x, y2: y });
  }, []);

  const onMouseUpRegion = useCallback(
    (e: React.MouseEvent) => {
      const d = drawing.current;
      if (!d) {
        return;
      }
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const dx = Math.abs(x - d.startX);
      const dy = Math.abs(y - d.startY);
      drawing.current = null;
      setLiveDraw(null);
      if (dx > 4 && dy > 4 && d.w > 0 && d.h > 0) {
        const norm = normalizeRect(d.startX, d.startY, x, y, d.w, d.h);
        setDrawnNorm({ page: d.page, rect: norm });
        setPdfRegion({
          page: d.page,
          x1: norm.x1,
          y1: norm.y1,
          x2: norm.x2,
          y2: norm.y2,
        });
      }
    },
    [setPdfRegion],
  );

  const handleAddComment = useCallback(async (overrideSel?: PdfTextSelection) => {
    try {
      if (regionMode && pdfRegion) {
        const comment = await createComment(
          filePath,
          0,
          0,
          "",
          "",
          { x1: pdfRegion.x1, y1: pdfRegion.y1, x2: pdfRegion.x2, y2: pdfRegion.y2 },
          pdfRegion.page,
        );
        addCommentToStore(comment);
        setDrawnNorm(null);
        setPdfRegion(null);
        return;
      }
      const captured = overrideSel ?? selectionRef.current ?? captureTextSelection();
      if (!captured) {
        return;
      }
      window.getSelection()?.removeAllRanges();
      selectionRef.current = null;
      const comment = await createComment(
        filePath,
        0,
        0,
        "",
        captured.text,
        undefined,
        captured.page,
      );
      addCommentToStore(comment);
    } catch (err) {
      console.error("Failed to create PDF comment:", err);
    }
  }, [captureTextSelection, filePath, regionMode, pdfRegion, addCommentToStore, setPdfRegion]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key === "c") {
        e.preventDefault();
        const captured = captureTextSelection();
        void handleAddComment(captured ?? undefined);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [captureTextSelection, handleAddComment]);

  useEffect(() => {
    if (!activeHighlight || activeHighlight.path !== filePath || activeHighlight.pdf_page == null) {
      setHighlightDisp(null);
      return;
    }
    const highlightPage = activeHighlight.pdf_page;
    let cancelled = false;
    let retryTimer: number | null = null;
    let clearTimer: number | null = null;
    let attempts = 0;

    const applyHighlight = () => {
      if (cancelled) {
        return;
      }
      const wrap = scrollRef.current?.querySelector(
        `[data-pdf-page="${highlightPage}"]`,
      ) as HTMLElement | null;
      if (!wrap) {
        if (attempts++ < 20) {
          retryTimer = window.setTimeout(applyHighlight, 100);
        }
        return;
      }

      wrap.scrollIntoView({ behavior: "smooth", block: "center" });

      let rects: NormRect[] = [];
      if (activeHighlight.region_x1 != null) {
        rects = [
          {
            x1: activeHighlight.region_x1,
            y1: activeHighlight.region_y1!,
            x2: activeHighlight.region_x2!,
            y2: activeHighlight.region_y2!,
          },
        ];
      } else if (activeHighlight.highlighted_text) {
        const textLayer = wrap.querySelector(".react-pdf__Page__textContent") as HTMLElement | null;
        if (!textLayer) {
          if (attempts++ < 20) {
            retryTimer = window.setTimeout(applyHighlight, 100);
          }
          return;
        }
        const range = findTextRange(textLayer, activeHighlight.highlighted_text);
        if (!range) {
          if (attempts++ < 20) {
            retryTimer = window.setTimeout(applyHighlight, 100);
          }
          return;
        }
        rects = rangeToNormRects(range, wrap);
      }

      if (rects.length === 0) {
        return;
      }

      setHighlightDisp({ page: highlightPage, rects });
      clearTimer = window.setTimeout(() => setHighlightDisp(null), 3500);
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
  }, [activeHighlight, filePath]);

  const src = pdfUrl(filePath, cacheBust);

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700 shrink-0 gap-2 flex-wrap">
        <span className="text-xs text-gray-400 font-mono truncate min-w-0">{filePath}</span>
        <div className="flex items-center gap-1.5 shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => {
              setRegionMode((m) => !m);
              setDrawnNorm(null);
              setPdfRegion(null);
              setLiveDraw(null);
            }}
            title={
              regionMode
                ? "Switch to text selection"
                : "Draw a rectangular region on a page"
            }
            className={regionMode ? toolbarBtnPrimary : toolbarBtnNeutral}
          >
            <span className="text-xs">{regionMode ? "Region on" : "Region"}</span>
          </button>
          <button
            type="button"
            onClick={() => bumpCenterReload()}
            aria-label="Reload PDF from disk"
            title="Reload PDF from disk"
            className={toolbarBtnNeutral}
          >
            <IconRefresh className={toolbarIconClass} />
            <span>Reload</span>
          </button>
          <button
            type="button"
            onClick={() => void handleAddComment()}
            aria-label="Add PDF comment (Ctrl+Alt+C)"
            title={
              regionMode
                ? "Add Comment (Ctrl+Alt+C) for drawn region"
                : "Add Comment (Ctrl+Alt+C) for selected text on one page"
            }
            className={toolbarBtnPrimary}
          >
            <IconPlus className={toolbarIconClass} />
            <span>Add (Ctrl+Alt+C)</span>
          </button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 overflow-auto bg-gray-900 p-4"
        onMouseUp={() => {
          if (!regionMode) {
            captureTextSelection();
          }
        }}
      >
        <Document
          file={src}
          loading={<div className="text-gray-400 text-sm">Loading PDF…</div>}
          error={
            <div className="text-red-400 text-sm">
              {loadError ?? "Failed to load PDF file."}
            </div>
          }
          onLoadSuccess={(d) => {
            setLoadError(null);
            setNumPages(d.numPages);
          }}
          onLoadError={(err) => {
            const message =
              err instanceof Error && err.message
                ? err.message
                : "Failed to load PDF file.";
            setLoadError(message);
            console.error("PDF load error", err);
          }}
        >
          <div className="flex flex-col items-center gap-4">
            {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => {
              const ph = pageHeights[pageNum] ?? 0;
              return (
                <div
                  key={pageNum}
                  data-pdf-page={pageNum}
                  className="relative inline-block shadow-lg border border-gray-700"
                >
                  <Page
                    pageNumber={pageNum}
                    width={pageWidth}
                    renderAnnotationLayer={false}
                    renderTextLayer={!regionMode}
                    onRenderSuccess={({ height }) =>
                      setPageHeights((prev) => (prev[pageNum] === height ? prev : { ...prev, [pageNum]: height }))
                    }
                  />
                  {regionMode && ph > 0 && (
                    <div
                      className="absolute top-0 left-0 cursor-crosshair bg-transparent z-10"
                      style={{ width: pageWidth, height: ph }}
                      onMouseDown={(e) => {
                        const tgt = e.currentTarget;
                        onMouseDownRegion(pageNum, tgt.clientWidth, tgt.clientHeight, e);
                      }}
                      onMouseMove={onMouseMoveRegion}
                      onMouseUp={onMouseUpRegion}
                      onMouseLeave={onMouseUpRegion}
                    />
                  )}
                  {ph > 0 && (
                    <svg
                      className="pointer-events-none absolute top-0 left-0 z-20 overflow-visible"
                      width={pageWidth}
                      height={ph}
                    >
                      {liveDraw && liveDraw.page === pageNum && (
                        <rect
                          x={Math.min(liveDraw.x1, liveDraw.x2)}
                          y={Math.min(liveDraw.y1, liveDraw.y2)}
                          width={Math.abs(liveDraw.x2 - liveDraw.x1)}
                          height={Math.abs(liveDraw.y2 - liveDraw.y1)}
                          fill="rgba(59,130,246,0.15)"
                          stroke="#3b82f6"
                          strokeWidth={2}
                          strokeDasharray="6 3"
                        />
                      )}
                      {drawnNorm && drawnNorm.page === pageNum && !liveDraw && (
                        <rect
                          x={drawnNorm.rect.x1 * pageWidth}
                          y={drawnNorm.rect.y1 * ph}
                          width={(drawnNorm.rect.x2 - drawnNorm.rect.x1) * pageWidth}
                          height={(drawnNorm.rect.y2 - drawnNorm.rect.y1) * ph}
                          fill="rgba(59,130,246,0.2)"
                          stroke="#3b82f6"
                          strokeWidth={2}
                        />
                      )}
                      {highlightDisp &&
                        highlightDisp.page === pageNum &&
                        highlightDisp.rects.map((rect, idx) => (
                          <rect
                            key={`highlight-${idx}`}
                            x={rect.x1 * pageWidth}
                            y={rect.y1 * ph}
                            width={(rect.x2 - rect.x1) * pageWidth}
                            height={(rect.y2 - rect.y1) * ph}
                            fill="rgba(234,179,8,0.25)"
                            stroke="#eab308"
                            strokeWidth={2}
                          />
                        ))}
                    </svg>
                  )}
                </div>
              );
            })}
          </div>
        </Document>
      </div>
    </div>
  );
}
