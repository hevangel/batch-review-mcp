import { useEffect, useRef, useCallback, useState } from "react";
import { useStore } from "./store";
import { listComments } from "./api";
import { useWebSocket } from "./ws";
import LeftPanel from "./components/LeftPanel/index";
import CenterPanel from "./components/CenterPanel/index";
import RightPanel from "./components/RightPanel/index";

const MIN_PANEL = 160;
const DEFAULT_LEFT = 288;  // w-72
const DEFAULT_RIGHT = 320; // w-80

export default function App() {
  const setComments = useStore((s) => s.setComments);
  useWebSocket();

  useEffect(() => {
    listComments()
      .then(setComments)
      .catch((e: Error) => console.error("Failed to load comments:", e));
  }, [setComments]);

  const [leftW, setLeftW] = useState(DEFAULT_LEFT);
  const [rightW, setRightW] = useState(DEFAULT_RIGHT);

  // --- left divider drag ---
  const leftDragging = useRef(false);
  const leftStart = useRef({ x: 0, w: 0 });

  const onLeftMouseDown = useCallback((e: React.MouseEvent) => {
    leftDragging.current = true;
    leftStart.current = { x: e.clientX, w: leftW };
    e.preventDefault();
  }, [leftW]);

  // --- right divider drag ---
  const rightDragging = useRef(false);
  const rightStart = useRef({ x: 0, w: 0 });

  const onRightMouseDown = useCallback((e: React.MouseEvent) => {
    rightDragging.current = true;
    rightStart.current = { x: e.clientX, w: rightW };
    e.preventDefault();
  }, [rightW]);

  // Global mouse move / up handlers
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (leftDragging.current) {
        const delta = e.clientX - leftStart.current.x;
        setLeftW(Math.max(MIN_PANEL, leftStart.current.w + delta));
      }
      if (rightDragging.current) {
        const delta = rightStart.current.x - e.clientX;
        setRightW(Math.max(MIN_PANEL, rightStart.current.w + delta));
      }
    };
    const onUp = () => {
      leftDragging.current = false;
      rightDragging.current = false;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-900 text-gray-100">
      {/* Left panel */}
      <div style={{ width: leftW, minWidth: MIN_PANEL }} className="shrink-0 h-full overflow-hidden">
        <LeftPanel />
      </div>

      {/* Left resize handle */}
      <div
        onMouseDown={onLeftMouseDown}
        className="w-1 h-full shrink-0 cursor-col-resize bg-gray-700 hover:bg-blue-500 transition-colors"
        title="Drag to resize"
      />

      {/* Center panel */}
      <div className="flex-1 h-full overflow-hidden">
        <CenterPanel />
      </div>

      {/* Right resize handle */}
      <div
        onMouseDown={onRightMouseDown}
        className="w-1 h-full shrink-0 cursor-col-resize bg-gray-700 hover:bg-blue-500 transition-colors"
        title="Drag to resize"
      />

      {/* Right panel */}
      <div style={{ width: rightW, minWidth: MIN_PANEL }} className="shrink-0 h-full overflow-hidden">
        <RightPanel />
      </div>
    </div>
  );
}
