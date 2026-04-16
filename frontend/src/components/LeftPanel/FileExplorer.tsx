import { useCallback, useMemo, useState } from "react";
import type { FileInfo } from "../../types";
import { useStore } from "../../store";

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
    if (n.is_dir) {
      out.add(n.path);
      if (n.children) collectDirPaths(n.children, out);
    }
  }
  return out;
}

interface TreeNodeProps {
  node: FileInfo;
  depth: number;
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
}

function TreeNode({ node, depth, expandedPaths, togglePath }: TreeNodeProps) {
  const openFile = useStore((s) => s.openFile);
  const expanded = node.is_dir && expandedPaths.has(node.path);

  const handleClick = () => {
    if (node.is_dir) {
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
        {node.is_dir && (
          <span className="mr-1 text-gray-400 text-xs">
            {expanded ? "▾" : "▸"}
          </span>
        )}
        {!node.is_dir && <span className="mr-1">{fileIcon(node.name)}</span>}
        {node.is_dir && <span className="mr-1">📁</span>}
        <span className="truncate">{node.name}</span>
      </button>
      {expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              togglePath={togglePath}
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
  error: string | null;
}

export default function FileExplorer({ files, loading, error }: FileExplorerProps) {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  const allDirPaths = useMemo(() => collectDirPaths(files), [files]);

  const togglePath = useCallback((path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const expandAll = () => setExpandedPaths(new Set(allDirPaths));
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
      <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-700">
        <button
          onClick={expandAll}
          className="text-xs text-gray-400 hover:text-gray-200 px-1.5 py-0.5 rounded hover:bg-gray-700"
          title="Expand all folders"
        >
          Expand All
        </button>
        <button
          onClick={collapseAll}
          className="text-xs text-gray-400 hover:text-gray-200 px-1.5 py-0.5 rounded hover:bg-gray-700"
          title="Collapse all folders"
        >
          Collapse All
        </button>
      </div>
      <div className="monaco-like-scrollbar overflow-y-auto flex-1 py-1">
        {files.map((f) => (
          <TreeNode
            key={f.path}
            node={f}
            depth={0}
            expandedPaths={expandedPaths}
            togglePath={togglePath}
          />
        ))}
      </div>
    </div>
  );
}
