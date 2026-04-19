import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../../store";
import { createComment, imageUrl } from "../../api";
import { IconPlus, IconRefresh, toolbarBtnNeutral, toolbarBtnPrimary, toolbarIconClass } from "../ui/toolbarIcons";

interface ImageViewerProps {
  filePath: string;
  /** Bumped when the parent reloads so the image URL changes and the browser refetches bytes. */
  cacheBust?: number;
}

interface Rect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export default function ImageViewer({ filePath, cacheBust }: ImageViewerProps) {
  const addCommentToStore = useStore((s) => s.addComment);
  const imageRegion = useStore((s) => s.imageRegion);
  const setImageRegion = useStore((s) => s.setImageRegion);
  const activeHighlight = useStore((s) => s.activeHighlight);
  const bumpCenterReload = useStore((s) => s.bumpCenterReload);

  const imgRef = useRef<HTMLImageElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Natural (original) image dimensions
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);

  // Currently being drawn rectangle (in display coords)
  const [drawing, setDrawing] = useState<{ startX: number; startY: number; curX: number; curY: number } | null>(null);

  // Finalized drawn rectangle (in display coords) for visual feedback
  const [drawnRect, setDrawnRect] = useState<Rect | null>(null);

  // Highlight rectangle from comment click (in display coords)
  const [highlightRect, setHighlightRect] = useState<Rect | null>(null);

  const handleImageLoad = () => {
    const img = imgRef.current;
    if (img) {
      setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
    }
  };

  // Convert display coords to original image pixel coords
  const toOriginal = useCallback(
    (rect: Rect): Rect => {
      const img = imgRef.current;
      if (!img || !naturalSize) return rect;
      const scaleX = naturalSize.w / img.clientWidth;
      const scaleY = naturalSize.h / img.clientHeight;
      return {
        x1: Math.round(Math.min(rect.x1, rect.x2) * scaleX),
        y1: Math.round(Math.min(rect.y1, rect.y2) * scaleY),
        x2: Math.round(Math.max(rect.x1, rect.x2) * scaleX),
        y2: Math.round(Math.max(rect.y1, rect.y2) * scaleY),
      };
    },
    [naturalSize],
  );

  // Convert original image pixel coords to display coords
  const toDisplay = useCallback(
    (rect: Rect): Rect | null => {
      const img = imgRef.current;
      if (!img || !naturalSize) return null;
      const scaleX = img.clientWidth / naturalSize.w;
      const scaleY = img.clientHeight / naturalSize.h;
      return {
        x1: rect.x1 * scaleX,
        y1: rect.y1 * scaleY,
        x2: rect.x2 * scaleX,
        y2: rect.y2 * scaleY,
      };
    },
    [naturalSize],
  );

  // Get mouse position relative to the image
  const getRelPos = (e: React.MouseEvent): { x: number; y: number } | null => {
    const img = imgRef.current;
    if (!img) return null;
    const r = img.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const pos = getRelPos(e);
    if (!pos) return;
    setDrawing({ startX: pos.x, startY: pos.y, curX: pos.x, curY: pos.y });
    setDrawnRect(null);
    setImageRegion(null);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drawing) return;
    const pos = getRelPos(e);
    if (!pos) return;
    setDrawing({ ...drawing, curX: pos.x, curY: pos.y });
  };

  const handleMouseUp = () => {
    if (!drawing) return;
    const dx = Math.abs(drawing.curX - drawing.startX);
    const dy = Math.abs(drawing.curY - drawing.startY);
    // Only register as a region if dragged more than 4px in both directions
    if (dx > 4 && dy > 4) {
      const displayRect: Rect = {
        x1: drawing.startX,
        y1: drawing.startY,
        x2: drawing.curX,
        y2: drawing.curY,
      };
      setDrawnRect(displayRect);
      const origRect = toOriginal(displayRect);
      setImageRegion(origRect);
    }
    setDrawing(null);
  };

  // Show highlight from comment click
  useEffect(() => {
    if (
      !activeHighlight ||
      activeHighlight.path !== filePath ||
      activeHighlight.region_x1 == null
    ) {
      setHighlightRect(null);
      return;
    }
    const origRect: Rect = {
      x1: activeHighlight.region_x1!,
      y1: activeHighlight.region_y1!,
      x2: activeHighlight.region_x2!,
      y2: activeHighlight.region_y2!,
    };
    const display = toDisplay(origRect);
    if (display) {
      setHighlightRect(display);
      const timer = setTimeout(() => setHighlightRect(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [activeHighlight, filePath, toDisplay]);

  // Clear drawn rect when file changes
  useEffect(() => {
    setDrawnRect(null);
    setImageRegion(null);
  }, [filePath, setImageRegion]);

  const handleAddComment = useCallback(async () => {
    try {
      const comment = await createComment(
        filePath,
        0,
        0,
        "",
        "",
        imageRegion ?? undefined,
      );
      addCommentToStore(comment);
      setDrawnRect(null);
      setImageRegion(null);
    } catch (e) {
      console.error("Failed to create comment:", e);
    }
  }, [filePath, imageRegion, addCommentToStore, setImageRegion]);

  // Ctrl+Alt+C keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.altKey && e.key === "c") {
        e.preventDefault();
        handleAddComment();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleAddComment]);

  // Build the live drawing rect for rendering
  const liveRect = drawing
    ? {
        x: Math.min(drawing.startX, drawing.curX),
        y: Math.min(drawing.startY, drawing.curY),
        w: Math.abs(drawing.curX - drawing.startX),
        h: Math.abs(drawing.curY - drawing.startY),
      }
    : null;

  const normalizedDrawn = drawnRect
    ? {
        x: Math.min(drawnRect.x1, drawnRect.x2),
        y: Math.min(drawnRect.y1, drawnRect.y2),
        w: Math.abs(drawnRect.x2 - drawnRect.x1),
        h: Math.abs(drawnRect.y2 - drawnRect.y1),
      }
    : null;

  const normalizedHighlight = highlightRect
    ? {
        x: Math.min(highlightRect.x1, highlightRect.x2),
        y: Math.min(highlightRect.y1, highlightRect.y2),
        w: Math.abs(highlightRect.x2 - highlightRect.x1),
        h: Math.abs(highlightRect.y2 - highlightRect.y1),
      }
    : null;

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-800 border-b border-gray-700 shrink-0 gap-2">
        <span className="text-xs text-gray-400 font-mono truncate min-w-0">{filePath}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => bumpCenterReload()}
            aria-label="Reload: fetch the latest image from disk"
            title="Reload image from disk (after the file changes on disk)"
            className={toolbarBtnNeutral}
          >
            <IconRefresh className={toolbarIconClass} />
            <span>Reload</span>
          </button>
          <button
            type="button"
            onClick={handleAddComment}
            aria-label="Add image-region comment (Ctrl+Alt+C)"
            title="Add Comment (Ctrl+Alt+C)"
            className={toolbarBtnPrimary}
          >
            <IconPlus className={toolbarIconClass} />
            <span>Add</span>
          </button>
        </div>
      </div>

      {/* Image container */}
      <div className="flex-1 overflow-auto flex items-center justify-center bg-gray-900 p-4">
        <div
          ref={wrapperRef}
          style={{ position: "relative", display: "inline-block", cursor: "crosshair" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
        >
          <img
            ref={imgRef}
            src={imageUrl(filePath, cacheBust)}
            onLoad={handleImageLoad}
            alt={filePath}
            style={{ maxWidth: "100%", display: "block", userSelect: "none" }}
            draggable={false}
          />

          {/* SVG overlay for rectangles */}
          {naturalSize && (
            <svg
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                pointerEvents: "none",
              }}
            >
              {/* Live drawing rectangle */}
              {liveRect && (
                <rect
                  x={liveRect.x}
                  y={liveRect.y}
                  width={liveRect.w}
                  height={liveRect.h}
                  fill="rgba(59,130,246,0.15)"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  strokeDasharray="6 3"
                />
              )}

              {/* Finalized drawn rectangle */}
              {normalizedDrawn && !liveRect && (
                <rect
                  x={normalizedDrawn.x}
                  y={normalizedDrawn.y}
                  width={normalizedDrawn.w}
                  height={normalizedDrawn.h}
                  fill="rgba(59,130,246,0.2)"
                  stroke="#3b82f6"
                  strokeWidth={2}
                />
              )}

              {/* Highlight rectangle from comment click */}
              {normalizedHighlight && (
                <rect
                  x={normalizedHighlight.x}
                  y={normalizedHighlight.y}
                  width={normalizedHighlight.w}
                  height={normalizedHighlight.h}
                  fill="rgba(234,179,8,0.25)"
                  stroke="#eab308"
                  strokeWidth={2}
                />
              )}
            </svg>
          )}
        </div>
      </div>
    </div>
  );
}
