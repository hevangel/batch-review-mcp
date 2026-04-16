import { useState } from "react";
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
};

function fileIcon(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (name.toLowerCase() === "dockerfile") return "🐳";
  return FILE_ICONS[ext] ?? "📄";
}

interface TreeNodeProps {
  node: FileInfo;
  depth: number;
}

function TreeNode({ node, depth }: TreeNodeProps) {
  const [expanded, setExpanded] = useState(depth < 1);
  const openFile = useStore((s) => s.openFile);

  const handleClick = async () => {
    if (node.is_dir) {
      setExpanded((e) => !e);
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
      {node.is_dir && expanded && node.children && (
        <div>
          {node.children.map((child) => (
            <TreeNode key={child.path} node={child} depth={depth + 1} />
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
    <div className="monaco-like-scrollbar overflow-y-auto h-full py-1">
      {files.map((f) => (
        <TreeNode key={f.path} node={f} depth={0} />
      ))}
    </div>
  );
}
