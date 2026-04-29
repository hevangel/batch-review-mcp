import { useCallback, useMemo, useState } from "react";
import type { FileInfo } from "../../types";
import { useStore } from "../../store";
import {
  IconCollapseAll,
  IconExpandAll,
  toolbarBtnBase,
} from "../ui/toolbarIcons";

const FILE_ICONS: Record<string, string> = {
  py: "🐍",
  js: "📜",
  jsx: "⚛️",
  ts: "📘",
  tsx: "⚛️",
  json: "📋",
  md: "📝",
  html: "🌐",
  css: "🎨",
  scss: "🎨",
  less: "🎨",
  sh: "🖥️",
  bash: "🖥️",
  yml: "⚙️",
  yaml: "⚙️",
  toml: "⚙️",
  rs: "🦀",
  go: "🐹",
  java: "☕",
  rb: "💎",
  php: "🐘",
  swift: "🍎",
  kt: "🎯",
  cs: "🔷",
  sql: "🗄️",
  dockerfile: "🐳",
  tf: "🏗️",
  png: "🖼️",
  jpg: "🖼️",
  jpeg: "🖼️",
  gif: "🖼️",
  webp: "🖼️",
  bmp: "🖼️",
  svg: "🖼️",
  ico: "🖼️",
};

function fileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (name.toLowerCase() === "dockerfile") return "🐳";
  return FILE_ICONS[ext] ?? "📄";
}

/** Collect paths of every directory node in the tree. */
function collectDirPaths(nodes: FileInfo[], out: Set<string> = new Set()): Set<string> {
  for (const n of nodes) {
    if (n.is_dir && (n.has_children ?? true)) {
      out.add(n.path);
      if (n.children) collectDirPaths(n.children, out);
    }
  }
  return out;
}

function collectUnloadedDirPaths(nodes: FileInfo[], out: Set<string> = new Set()): Set<string> {
  for (const n of nodes) {
    if (n.is_dir && (n.has_children ?? true)) {
      if (n.children_loaded === false) {
        out.add(n.path);
      }
      if (n.children) collectUnloadedDirPaths(n.children, out);
    }
  }
  return out;
}

interface TreeNodeProps {
  node: FileInfo;
  depth: number;
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
  loadingPaths: Set<string>;
  onLoadDirectory: (path: string) => void;
}

function TreeNode({ node, depth, expandedPaths, togglePath, loadingPaths, onLoadDirectory }: TreeNodeProps) {
  const openFile = useStore((s) => s.openFile);
  const expanded = node.is_dir && expandedPaths.has(node.path);
  const expandable = node.is_dir && (node.has_children ?? true);
  const loading = node.is_dir && loadingPaths.has(node.path);

  const handleClick = () => {
    if (node.is_dir) {
      if (!expanded && node.children_loaded === false && !loading) {
        onLoadDirectory(node.path);
      }
      togglePath(node.path);
    } else {
      openFile(node.path, "view");
    }
  };

  const indent = depth * 16;

  return (
    <div>
      <button
        onClick={handleClick}
        className="flex items-center w-full text-left px-2 py-0.5 hover:bg-gray-700 rounded text-sm text-gray-200 truncate"
        style={{ paddingLeft: `${indent + 8}px` }}
        title={node.path}
      >
        {expandable && (
          <span className="mr-1 text-gray-400 text-xs">
            {expanded ? "▾" : "▸"}
          </span>
        )}
        {node.is_dir && !expandable && <span className="mr-1 w-[0.75rem]" />}
        {!node.is_dir && <span className="mr-1">{fileIcon(node.name)}</span>}
        {node.is_dir && <span className="mr-1">📁</span>}
        <span className="truncate">{node.name}</span>
      </button>
      {expanded && loading && (
        <div
          className="px-2 py-0.5 text-xs text-gray-500"
          style={{ paddingLeft: `${indent + 24}px` }}
        >
          Loading…
        </div>
      )}
      {expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              togglePath={togglePath}
              loadingPaths={loadingPaths}
              onLoadDirectory={onLoadDirectory}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface FileExplorerProps {
  files: FileInfo[];
  loading: boolean;
  backgroundLoading: boolean;
  error: string | null;
  loadingPaths: Set<string>;
  onLoadDirectory: (path: string) => void;
}

export default function FileExplorer({
  files,
  loading,
  backgroundLoading,
  error,
  loadingPaths,
  onLoadDirectory,
}: FileExplorerProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const allDirPaths = useMemo(() => collectDirPaths(files), [files]);
  const unloadedDirPaths = useMemo(() => collectUnloadedDirPaths(files), [files]);

  const togglePath = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const expandAll = () => {
    setExpandedPaths(new Set(allDirPaths));
    unloadedDirPaths.forEach(onLoadDirectory);
  };
  const collapseAll = () => setExpandedPaths(new Set());

  if (loading) {
    return (
      <div className="p-3 text-gray-400 text-sm">Loading files…</div>
    );
  }
  if (error) {
    return (
      <div className="p-3 text-red-400 text-sm">{error}</div>
    );
  }
  if (files.length === 0) {
    return (
      <div className="p-3 text-gray-500 text-sm">No files found.</div>
    );
  }
  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-1 px-2 py-1 border-b border-gray-700">
        <button
          type="button"
          onClick={expandAll}
          aria-label="Expand all folders in the file tree"
          title="Expand all folders"
          className={`${toolbarBtnBase} text-gray-200 bg-gray-700 hover:bg-gray-600 border border-gray-600 leading-none`}
        >
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            <IconExpandAll className="block h-3.5 w-3.5 max-h-full max-w-full" />
          </span>
          <span className="leading-tight">Expand all</span>
        </button>
        <button
          type="button"
          onClick={collapseAll}
          aria-label="Collapse all folders in the file tree"
          title="Collapse all folders"
          className={`${toolbarBtnBase} text-gray-200 bg-gray-700 hover:bg-gray-600 border border-gray-600 leading-none`}
        >
          <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
            <IconCollapseAll className="block h-3.5 w-3.5 max-h-full max-w-full" />
          </span>
          <span className="leading-tight">Collapse all</span>
        </button>
        {backgroundLoading && (
          <span className="ml-auto text-xs text-gray-500">Loading deeper folders…</span>
        )}
      </div>
      <div className="monaco-like-scrollbar overflow-y-auto flex-1 py-1">
        {files.map((f) => (
          <TreeNode
            key={f.path}
            node={f}
            depth={0}
            expandedPaths={expandedPaths}
            togglePath={togglePath}
            loadingPaths={loadingPaths}
            onLoadDirectory={onLoadDirectory}
          />
        ))}
      </div>
    </div>
  );
}
