import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import html2canvas from "html2canvas";
import { renderAsync } from "docx-preview";
import {
  PptxViewer as PptxRendererViewer,
  RECOMMENDED_ZIP_LIMITS,
} from "@aiden0z/pptx-renderer";
import { createComment, officeUrl, uploadRegionScreenshot } from "../../api";
import type { DiffResponse, DocumentKind } from "../../types";
import { useStore } from "../../store";
import {
  IconPlus,
  IconRefresh,
  toolbarBtnNeutral,
  toolbarBtnPrimary,
  toolbarIconClass,
} from "../ui/toolbarIcons";

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

type OfficeAnchorKind = "document_text" | "document_region";

interface OfficeAnchor {
  anchor_kind: OfficeAnchorKind;
  document_kind: DocumentKind;
  document_page: number;
  document_anchor: string;
  document_fingerprint: string;
  highlighted_text: string;
  region?: Rect;
}

interface DrawingState {
  page: HTMLElement;
  pageNumber: number;
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface OfficeViewerProps {
  filePath: string;
  documentKind: DocumentKind;
  cacheBust?: number;
}

const OFFICE_PAGE_ATTR = "data-batch-review-document-page";
const OFFICE_OVERLAY_ATTR = "data-batch-review-office-overlay";

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function hashText(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function normalizedRect(rect: DOMRect, pageRect: DOMRect): Rect | null {
  if (pageRect.width <= 0 || pageRect.height <= 0 || rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  return {
    x1: clamp01((rect.left - pageRect.left) / pageRect.width),
    y1: clamp01((rect.top - pageRect.top) / pageRect.height),
    x2: clamp01((rect.right - pageRect.left) / pageRect.width),
    y2: clamp01((rect.bottom - pageRect.top) / pageRect.height),
  };
}

function nodeElement(node: Node | null): HTMLElement | null {
  if (!node) {
    return null;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    return node as HTMLElement;
  }
  return node.parentElement;
}

function pageForNode(
  root: HTMLElement,
  node: Node | null,
  pages: readonly HTMLElement[],
): HTMLElement | null {
  const element = nodeElement(node);
  const closest = element?.closest(`[${OFFICE_PAGE_ATTR}]`) as HTMLElement | null;
  if (closest) {
    return closest;
  }
  return pages.find((page) => Boolean(element && page.contains(element))) ?? null;
}

function markPage(page: HTMLElement, pageNumber: number): HTMLElement {
  page.dataset.batchReviewDocumentPage = String(pageNumber);
  if (!page.style.position || page.style.position === "static") {
    page.style.position = "relative";
  }
  return page;
}

function docxPages(root: HTMLElement): HTMLElement[] {
  const sections = Array.from(root.querySelectorAll<HTMLElement>("section.docx"));
  const candidates = sections.length
    ? sections
    : Array.from(root.children).filter((child): child is HTMLElement => child instanceof HTMLElement);
  return candidates.map((page, index) => markPage(page, index + 1));
}

function pageNumber(page: HTMLElement): number {
  return Number.parseInt(page.dataset.batchReviewDocumentPage ?? "1", 10) || 1;
}

function pageRectForAnchor(page: HTMLElement, anchor: Rect): Rect {
  return {
    x1: Math.min(anchor.x1, anchor.x2),
    y1: Math.min(anchor.y1, anchor.y2),
    x2: Math.max(anchor.x1, anchor.x2),
    y2: Math.max(anchor.y1, anchor.y2),
  };
}

function findTextRange(root: HTMLElement, text: string): Range | null {
  const needle = text.trim();
  if (!needle) {
    return null;
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: { node: Text; start: number; end: number }[] = [];
  let fullText = "";
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const textNode = current as Text;
    const start = fullText.length;
    fullText += textNode.data;
    nodes.push({ node: textNode, start, end: fullText.length });
  }

  let startIndex = fullText.indexOf(needle);
  let matchedText = needle;
  if (startIndex < 0) {
    const normalizedFull = fullText.replace(/\s+/g, " ");
    const normalizedNeedle = needle.replace(/\s+/g, " ");
    startIndex = normalizedFull.indexOf(normalizedNeedle);
    if (startIndex < 0) {
      return null;
    }
    matchedText = normalizedNeedle;
  }
  const endIndex = startIndex + matchedText.length;
  const startNode = nodes.find((entry) => startIndex >= entry.start && startIndex <= entry.end);
  const endNode = nodes.find((entry) => endIndex >= entry.start && endIndex <= entry.end);
  if (!startNode || !endNode) {
    return null;
  }

  const range = document.createRange();
  range.setStart(startNode.node, Math.max(0, startIndex - startNode.start));
  range.setEnd(endNode.node, Math.max(0, endIndex - endNode.start));
  return range;
}

function removeOverlay(page: HTMLElement, name: string): void {
  page.querySelector(`[${OFFICE_OVERLAY_ATTR}="${name}"]`)?.remove();
}

function drawOverlay(page: HTMLElement, name: string, rect: Rect, className: string): void {
  let overlay = page.querySelector<HTMLDivElement>(`[${OFFICE_OVERLAY_ATTR}="${name}"]`);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.dataset.batchReviewOfficeOverlay = name;
    overlay.className = className;
    page.appendChild(overlay);
  }
  const normalized = pageRectForAnchor(page, rect);
  overlay.style.left = `${normalized.x1 * 100}%`;
  overlay.style.top = `${normalized.y1 * 100}%`;
  overlay.style.width = `${(normalized.x2 - normalized.x1) * 100}%`;
  overlay.style.height = `${(normalized.y2 - normalized.y1) * 100}%`;
}

function anchorFromSelection(
  root: HTMLElement,
  pages: readonly HTMLElement[],
  documentKind: DocumentKind,
): OfficeAnchor | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
    return null;
  }
  const highlightedText = selection.toString().trim();
  if (!highlightedText) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const page = pageForNode(root, range.startContainer, pages);
  if (!page) {
    return null;
  }
  const region = normalizedRect(range.getBoundingClientRect(), page.getBoundingClientRect());
  const fingerprint = hashText(highlightedText);
  return {
    anchor_kind: "document_text",
    document_kind: documentKind,
    document_page: pageNumber(page),
    document_anchor: `${documentKind}:page-${pageNumber(page)}:text-${fingerprint}`,
    document_fingerprint: fingerprint,
    highlighted_text: highlightedText,
    ...(region ? { region } : {}),
  };
}

function documentRegionAnchor(
  documentKind: DocumentKind,
  page: HTMLElement,
  region: Rect,
): OfficeAnchor {
  const pageIndex = pageNumber(page);
  const fingerprint = hashText(
    `${documentKind}:${pageIndex}:${region.x1.toFixed(4)},${region.y1.toFixed(4)},${region.x2.toFixed(4)},${region.y2.toFixed(4)}`,
  );
  return {
    anchor_kind: "document_region",
    document_kind: documentKind,
    document_page: pageIndex,
    document_anchor: `${documentKind}:page-${pageIndex}:region-${fingerprint}`,
    document_fingerprint: fingerprint,
    highlighted_text: "",
    region,
  };
}

interface OfficeRegionScreenshot {
  blob: Blob;
  width: number;
  height: number;
}

interface DocxSurfaceSize {
  width: number;
  height: number;
}

function measureDocxSurface(surface: HTMLElement, pages: readonly HTMLElement[]): DocxSurfaceSize {
  const surfaceRect = surface.getBoundingClientRect();
  return pages.reduce(
    (size, page) => {
      const pageRect = page.getBoundingClientRect();
      return {
        width: Math.max(size.width, pageRect.right - surfaceRect.left),
        height: Math.max(size.height, pageRect.bottom - surfaceRect.top),
      };
    },
    {
      width: Math.max(surface.scrollWidth, 1),
      height: Math.max(surface.scrollHeight, 1),
    },
  );
}

async function captureOfficeRegionScreenshot(
  page: HTMLElement,
  region: Rect,
): Promise<OfficeRegionScreenshot> {
  const pageBounds = page.getBoundingClientRect();
  if (pageBounds.width <= 0 || pageBounds.height <= 0) {
    throw new Error("The document page is not ready for screenshot capture.");
  }

  const canvas = await html2canvas(page, {
    backgroundColor: null,
    useCORS: true,
    allowTaint: false,
    logging: false,
    ignoreElements: (element) => element.hasAttribute(OFFICE_OVERLAY_ATTR),
  });
  if (canvas.width <= 0 || canvas.height <= 0) {
    throw new Error("The document page produced an empty screenshot.");
  }

  const x1 = clamp01(Math.min(region.x1, region.x2));
  const y1 = clamp01(Math.min(region.y1, region.y2));
  const x2 = clamp01(Math.max(region.x1, region.x2));
  const y2 = clamp01(Math.max(region.y1, region.y2));
  const cropX = Math.max(0, Math.min(canvas.width - 1, Math.floor(x1 * canvas.width)));
  const cropY = Math.max(0, Math.min(canvas.height - 1, Math.floor(y1 * canvas.height)));
  const cropRight = Math.max(cropX + 1, Math.min(canvas.width, Math.ceil(x2 * canvas.width)));
  const cropBottom = Math.max(cropY + 1, Math.min(canvas.height, Math.ceil(y2 * canvas.height)));
  const cropCanvas = document.createElement("canvas");
  cropCanvas.width = cropRight - cropX;
  cropCanvas.height = cropBottom - cropY;
  const context = cropCanvas.getContext("2d");
  if (!context) {
    throw new Error("Cannot create document screenshot canvas.");
  }
  context.drawImage(
    canvas,
    cropX,
    cropY,
    cropCanvas.width,
    cropCanvas.height,
    0,
    0,
    cropCanvas.width,
    cropCanvas.height,
  );
  const blob = await new Promise<Blob | null>((resolve) => cropCanvas.toBlob(resolve, "image/png"));
  if (!blob) {
    throw new Error("Cannot encode document region screenshot.");
  }
  return { blob, width: cropCanvas.width, height: cropCanvas.height };
}

export default function OfficeViewer({ filePath, documentKind, cacheBust }: OfficeViewerProps) {
  const addCommentToStore = useStore((state) => state.addComment);
  const activeHighlight = useStore((state) => state.activeHighlight);
  const bumpCenterReload = useStore((state) => state.bumpCenterReload);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<PptxRendererViewer | null>(null);
  const pagesRef = useRef<HTMLElement[]>([]);
  const selectedAnchorRef = useRef<OfficeAnchor | null>(null);
  const drawingRef = useRef<DrawingState | null>(null);
  const regionModeRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [regionMode, setRegionMode] = useState(false);
  const [selectedAnchor, setSelectedAnchor] = useState<OfficeAnchor | null>(null);
  const [renderVersion, setRenderVersion] = useState(0);

  useEffect(() => {
    regionModeRef.current = regionMode;
  }, [regionMode]);

  const registerPage = useCallback((page: HTMLElement, index: number) => {
    const marked = markPage(page, index + 1);
    pagesRef.current = [
      ...pagesRef.current.filter((existing) => pageNumber(existing) !== index + 1),
      marked,
    ].sort((left, right) => pageNumber(left) - pageNumber(right));
    setRenderVersion((version) => version + 1);
  }, []);

  const unregisterPage = useCallback((index: number) => {
    pagesRef.current = pagesRef.current.filter((page) => pageNumber(page) !== index + 1);
    setRenderVersion((version) => version + 1);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      return;
    }
    let cancelled = false;
    let docxResizeObserver: ResizeObserver | null = null;
    let docxResizeFrame: number | null = null;
    setLoading(true);
    setError(null);
    setCaptureError(null);
    setSelectedAnchor(null);
    selectedAnchorRef.current = null;
    pagesRef.current = [];
    viewerRef.current?.destroy();
    viewerRef.current = null;
    root.innerHTML = "";

    const load = async () => {
      try {
        const response = await fetch(officeUrl(filePath, cacheBust));
        if (!response.ok) {
          throw new Error(`Document request failed (${response.status}).`);
        }
        const data = await response.arrayBuffer();
        if (cancelled) {
          return;
        }

        if (documentKind === "docx") {
          const frame = document.createElement("div");
          frame.className = "office-docx-frame";
          const surface = document.createElement("div");
          surface.className = "office-docx-surface";
          surface.style.width = "max-content";
          frame.appendChild(surface);
          root.appendChild(frame);

          await renderAsync(data, surface, undefined, {
            breakPages: true,
            ignoreLastRenderedPageBreak: false,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            renderEndnotes: true,
            renderComments: false,
          });
          if (!cancelled) {
            pagesRef.current = docxPages(surface);
            const intrinsicSize = measureDocxSurface(surface, pagesRef.current);
            const applyScale = () => {
              const container = scrollContainerRef.current;
              if (!container) {
                return;
              }
              const containerStyle = getComputedStyle(container);
              const horizontalPadding =
                (Number.parseFloat(containerStyle.paddingLeft) || 0) +
                (Number.parseFloat(containerStyle.paddingRight) || 0);
              const availableWidth = Math.max(1, container.clientWidth - horizontalPadding);
              const scale = Math.min(1, availableWidth / intrinsicSize.width);
              frame.style.width = `${Math.ceil(intrinsicSize.width * scale)}px`;
              frame.style.height = `${Math.ceil(intrinsicSize.height * scale)}px`;
              surface.style.width = `${intrinsicSize.width}px`;
              surface.style.height = `${intrinsicSize.height}px`;
              surface.style.transform = `scale(${scale})`;
            };
            const scheduleScale = () => {
              if (docxResizeFrame != null) {
                return;
              }
              docxResizeFrame = window.requestAnimationFrame(() => {
                docxResizeFrame = null;
                if (!cancelled) {
                  applyScale();
                }
              });
            };
            applyScale();
            const container = scrollContainerRef.current;
            if (container && typeof ResizeObserver !== "undefined") {
              docxResizeObserver = new ResizeObserver(scheduleScale);
              docxResizeObserver.observe(container);
            }
            setRenderVersion((version) => version + 1);
          }
        } else {
          const viewer = await PptxRendererViewer.open(data, root, {
            fitMode: "contain",
            scrollContainer: scrollContainerRef.current ?? undefined,
            lazyMedia: true,
            lazySlides: true,
            pdfjs: false,
            zipLimits: RECOMMENDED_ZIP_LIMITS,
            listOptions: {
              windowed: true,
              batchSize: 4,
              initialSlides: 4,
              showSlideLabels: true,
            },
            onSlideRendered: (index, element) => registerPage(element, index),
            onSlideUnmounted: (index) => unregisterPage(index),
            onSlideError: (index, renderError) => {
              console.warn(`PPTX slide ${index + 1} could not render`, renderError);
            },
          });
          if (cancelled) {
            viewer.destroy();
            return;
          }
          viewerRef.current = viewer;
        }
        if (!cancelled) {
          setLoading(false);
        }
      } catch (loadError) {
        if (!cancelled) {
          setLoading(false);
          setError(loadError instanceof Error ? loadError.message : String(loadError));
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
      docxResizeObserver?.disconnect();
      if (docxResizeFrame != null) {
        window.cancelAnimationFrame(docxResizeFrame);
        docxResizeFrame = null;
      }
      drawingRef.current = null;
      viewerRef.current?.destroy();
      viewerRef.current = null;
      pagesRef.current = [];
      root.innerHTML = "";
    };
  }, [cacheBust, documentKind, filePath, registerPage, unregisterPage]);

  useEffect(() => {
    if (
      !activeHighlight ||
      activeHighlight.path !== filePath ||
      (activeHighlight.document_kind != null && activeHighlight.document_kind !== documentKind)
    ) {
      return;
    }
    const targetPage = activeHighlight.document_page ?? 1;
    let cancelled = false;
    let retryTimer: number | null = null;
    let clearTimer: number | null = null;
    let attempts = 0;

    const applyHighlight = async () => {
      if (cancelled) {
        return;
      }

      let page = pagesRef.current.find((candidate) => pageNumber(candidate) === targetPage) ?? null;
      if (!page && documentKind === "pptx") {
        const viewer = viewerRef.current;
        if (viewer && viewer.slideCount > 0) {
          const targetIndex = Math.min(
            Math.max(targetPage - 1, 0),
            viewer.slideCount - 1,
          );
          try {
            await viewer.goToSlide(targetIndex, { behavior: "smooth", block: "center" });
          } catch (navigationError) {
            console.warn(`PPTX slide ${targetPage} could not be selected`, navigationError);
          }
          if (cancelled) {
            return;
          }
          page = pagesRef.current.find((candidate) => pageNumber(candidate) === targetPage) ?? null;
        }
      }

      if (!page) {
        if (attempts++ < 30) {
          retryTimer = window.setTimeout(() => void applyHighlight(), 100);
        }
        return;
      }

      page.scrollIntoView({ behavior: "smooth", block: "center" });
      let region: Rect | null = null;
      if (
        activeHighlight.region_x1 != null &&
        activeHighlight.region_y1 != null &&
        activeHighlight.region_x2 != null &&
        activeHighlight.region_y2 != null
      ) {
        region = {
          x1: activeHighlight.region_x1,
          y1: activeHighlight.region_y1,
          x2: activeHighlight.region_x2,
          y2: activeHighlight.region_y2,
        };
      } else if (activeHighlight.highlighted_text) {
        const range = findTextRange(page, activeHighlight.highlighted_text);
        if (range) {
          region = normalizedRect(range.getBoundingClientRect(), page.getBoundingClientRect());
        }
      }
      if (!region) {
        if (activeHighlight.highlighted_text && attempts++ < 30) {
          retryTimer = window.setTimeout(() => void applyHighlight(), 100);
        }
        return;
      }
      const highlightedPage = page;
      drawOverlay(highlightedPage, "jump", region, "batch-review-office-jump");
      clearTimer = window.setTimeout(() => removeOverlay(highlightedPage, "jump"), 3500);
    };

    void applyHighlight();
    return () => {
      cancelled = true;
      if (retryTimer != null) {
        window.clearTimeout(retryTimer);
      }
      if (clearTimer != null) {
        window.clearTimeout(clearTimer);
      }
    };
  }, [activeHighlight, documentKind, filePath, renderVersion]);

  const clearSelectedAnchor = useCallback(() => {
    selectedAnchorRef.current = null;
    setSelectedAnchor(null);
    setCaptureError(null);
    pagesRef.current.forEach((page) => removeOverlay(page, "selected"));
    window.getSelection()?.removeAllRanges();
  }, []);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!regionModeRef.current || event.button !== 0) {
        return;
      }
      const root = rootRef.current;
      if (!root) {
        return;
      }
      const page = pageForNode(root, event.target as Node, pagesRef.current);
      if (!page) {
        return;
      }
      const pageBounds = page.getBoundingClientRect();
      drawingRef.current = {
        page,
        pageNumber: pageNumber(page),
        startX: event.clientX - pageBounds.left,
        startY: event.clientY - pageBounds.top,
        currentX: event.clientX - pageBounds.left,
        currentY: event.clientY - pageBounds.top,
      };
      clearSelectedAnchor();
      event.preventDefault();
      event.currentTarget.setPointerCapture?.(event.pointerId);
    },
    [clearSelectedAnchor],
  );

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const drawing = drawingRef.current;
    if (!drawing) {
      return;
    }
    const pageBounds = drawing.page.getBoundingClientRect();
    drawing.currentX = event.clientX - pageBounds.left;
    drawing.currentY = event.clientY - pageBounds.top;
    const rect = normalizedRect(
      new DOMRect(
        Math.min(drawing.startX, drawing.currentX) + pageBounds.left,
        Math.min(drawing.startY, drawing.currentY) + pageBounds.top,
        Math.abs(drawing.currentX - drawing.startX),
        Math.abs(drawing.currentY - drawing.startY),
      ),
      pageBounds,
    );
    if (rect) {
      drawOverlay(drawing.page, "drawing", rect, "batch-review-office-drawing");
    }
    event.preventDefault();
  }, []);

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drawing = drawingRef.current;
      if (!drawing) {
        return;
      }
      const pageBounds = drawing.page.getBoundingClientRect();
      const width = Math.abs(drawing.currentX - drawing.startX);
      const height = Math.abs(drawing.currentY - drawing.startY);
      removeOverlay(drawing.page, "drawing");
      drawingRef.current = null;
      event.currentTarget.releasePointerCapture?.(event.pointerId);
      if (width <= 6 || height <= 6) {
        return;
      }
      const region = normalizedRect(
        new DOMRect(
          Math.min(drawing.startX, drawing.currentX) + pageBounds.left,
          Math.min(drawing.startY, drawing.currentY) + pageBounds.top,
          width,
          height,
        ),
        pageBounds,
      );
      if (!region) {
        return;
      }
      const anchor = documentRegionAnchor(documentKind, drawing.page, region);
      selectedAnchorRef.current = anchor;
      setSelectedAnchor(anchor);
      drawOverlay(drawing.page, "selected", region, "batch-review-office-selected");
      event.preventDefault();
    },
    [documentKind],
  );

  const handleMouseUp = useCallback(() => {
    if (regionModeRef.current || drawingRef.current) {
      return;
    }
    window.setTimeout(() => {
      const root = rootRef.current;
      if (!root) {
        return;
      }
      const anchor = anchorFromSelection(root, pagesRef.current, documentKind);
      if (!anchor) {
        return;
      }
      selectedAnchorRef.current = anchor;
      setSelectedAnchor(anchor);
      if (anchor.region) {
        const page = pagesRef.current.find((candidate) => pageNumber(candidate) === anchor.document_page);
        if (page) {
          drawOverlay(page, "selected", anchor.region, "batch-review-office-selected");
        }
      }
    }, 0);
  }, [documentKind]);

  const handleAddComment = useCallback(async () => {
    const anchor = selectedAnchorRef.current;
    if (!anchor) {
      return;
    }
    try {
      setCaptureError(null);
      let screenshot: OfficeRegionScreenshot | null = null;
      if (anchor.anchor_kind === "document_region") {
        if (!anchor.region) {
          throw new Error("The selected document region has no coordinates.");
        }
        let page = pagesRef.current.find(
          (candidate) => pageNumber(candidate) === anchor.document_page,
        ) ?? null;
        if (!page && anchor.document_kind === "pptx") {
          const viewer = viewerRef.current;
          if (viewer && viewer.slideCount > 0) {
            const targetIndex = Math.min(
              Math.max(anchor.document_page - 1, 0),
              viewer.slideCount - 1,
            );
            await viewer.goToSlide(targetIndex, { behavior: "smooth", block: "center" });
            for (let attempt = 0; attempt < 20 && !page; attempt += 1) {
              await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
              page = pagesRef.current.find(
                (candidate) => pageNumber(candidate) === anchor.document_page,
              ) ?? null;
            }
          }
        }
        if (!page) {
          throw new Error(`The selected ${documentKind.toUpperCase()} page is no longer rendered.`);
        }
        screenshot = await captureOfficeRegionScreenshot(page, anchor.region);
      }

      const comment = await createComment(
        filePath,
        0,
        0,
        "",
        anchor.highlighted_text,
        anchor.region,
        undefined,
        {
          anchor_kind: anchor.anchor_kind,
          document_kind: anchor.document_kind,
          document_page: anchor.document_page,
          document_anchor: anchor.document_anchor,
          document_fingerprint: anchor.document_fingerprint,
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
      clearSelectedAnchor();
    } catch (addError) {
      console.error("Failed to create document comment:", addError);
      setCaptureError(addError instanceof Error ? addError.message : String(addError));
    }
  }, [addCommentToStore, clearSelectedAnchor, documentKind, filePath]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.ctrlKey && event.altKey && event.key === "c") {
        event.preventDefault();
        void handleAddComment();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleAddComment]);

  const pageLabel = documentKind === "pptx" ? "slide" : "page";
  const selectionLabel = selectedAnchor
    ? `${selectedAnchor.anchor_kind === "document_region" ? "Region" : "Text"} selected on ${pageLabel} ${selectedAnchor.document_page}`
    : regionMode
      ? `Drag a region on a ${pageLabel} to anchor a comment`
      : `Select text, or switch to Region mode for a visual comment`;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700 shrink-0 gap-2">
        <span className="text-xs text-gray-400 font-mono truncate min-w-0">{filePath}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => bumpCenterReload()}
            aria-label="Reload document from disk"
            title="Reload document from disk"
            className={toolbarBtnNeutral}
          >
            <IconRefresh className={toolbarIconClass} />
            <span>Reload</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setRegionMode((value) => !value);
              clearSelectedAnchor();
            }}
            className={regionMode ? toolbarBtnPrimary : toolbarBtnNeutral}
            title={regionMode ? "Switch back to text selection" : "Select a visual document region"}
          >
            <span className="text-xs">▣</span>
            <span>{regionMode ? "Text" : "Region"}</span>
          </button>
          <button
            type="button"
            onClick={() => void handleAddComment()}
            disabled={!selectedAnchor}
            aria-label="Add comment from the selected document text or region"
            title="Add Comment (Ctrl+Alt+C)"
            className={toolbarBtnPrimary}
          >
            <IconPlus className={toolbarIconClass} />
            <span>Add</span>
          </button>
        </div>
      </div>
      <div className="px-3 py-1 text-[11px] text-gray-400 bg-gray-850 border-b border-gray-800 shrink-0">
        {selectionLabel}
      </div>
      {captureError && (
        <div className="px-3 py-1 text-[11px] text-red-300 bg-red-950/40 border-b border-red-900/70 shrink-0">
          {captureError}
        </div>
      )}
      <div
        ref={scrollContainerRef}
        className="relative flex-1 overflow-auto bg-gray-900 p-4"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onMouseUp={handleMouseUp}
      >
        {loading && (
          <div className="flex h-full items-center justify-center text-sm text-gray-400">
            Rendering {documentKind.toUpperCase()}…
          </div>
        )}
        {error && (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-red-400">
            <p>{error}</p>
            <button type="button" onClick={() => bumpCenterReload()} className={toolbarBtnNeutral}>
              <IconRefresh className={toolbarIconClass} />
              <span>Retry</span>
            </button>
          </div>
        )}
        <div
          ref={rootRef}
          className="office-document-host min-h-full flex flex-col items-center gap-4"
          style={{ userSelect: regionMode ? "none" : "text" }}
        />
      </div>
      <style>{`
        .office-docx-frame {
          position: relative;
          flex: 0 0 auto;
        }
        .office-docx-surface {
          position: absolute;
          top: 0;
          left: 0;
          transform-origin: top left;
        }
        .office-docx-surface > .docx-wrapper { width: max-content !important; }
        .office-docx-surface section.docx { margin: 0 auto 16px; }
        .office-document-host [${OFFICE_PAGE_ATTR}] { box-sizing: border-box; }
        .batch-review-office-drawing,
        .batch-review-office-selected,
        .batch-review-office-jump {
          position: absolute !important;
          z-index: 2147483647 !important;
          pointer-events: none !important;
          box-sizing: border-box !important;
        }
        .batch-review-office-drawing {
          border: 2px dashed #60a5fa !important;
          background: rgba(59, 130, 246, 0.12) !important;
        }
        .batch-review-office-selected {
          border: 3px solid #3b82f6 !important;
          background: rgba(59, 130, 246, 0.12) !important;
        }
        .batch-review-office-jump {
          border: 3px solid #eab308 !important;
          background: rgba(234, 179, 8, 0.22) !important;
        }
      `}</style>
    </div>
  );
}

export function OfficeDiffNotice({ filePath, diff }: { filePath: string; diff: DiffResponse }) {
  const openFile = useStore((state) => state.openFile);
  const kind = diff.language?.toUpperCase() || "Office";
  return (
    <div className="flex h-full items-center justify-center bg-gray-900 p-6">
      <div className="max-w-lg rounded-xl border border-gray-700 bg-gray-800 p-6 text-center shadow-lg">
        <h2 className="text-lg font-semibold text-gray-100">{kind} visual diff is not available</h2>
        <p className="mt-3 text-sm leading-6 text-gray-400">
          {diff.message ?? "Office documents are binary packages and are not shown as raw ZIP/XML diffs."}
        </p>
        <p className="mt-2 text-xs text-gray-500">
          Open the current document to review its rendered pages or slides and add anchored comments.
        </p>
        <button type="button" onClick={() => openFile(filePath, "view")} className={`${toolbarBtnPrimary} mt-5`}>
          <span>Open {kind} viewer</span>
        </button>
      </div>
    </div>
  );
}
