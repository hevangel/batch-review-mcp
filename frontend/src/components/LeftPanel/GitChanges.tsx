import type { GitChange } from "../../types";
import { useStore } from "../../store";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  M: { label: "M", color: "bg-yellow-600 text-yellow-100" },
  A: { label: "A", color: "bg-green-700 text-green-100" },
  D: { label: "D", color: "bg-red-700 text-red-100" },
  R: { label: "R", color: "bg-blue-700 text-blue-100" },
  "?": { label: "U", color: "bg-gray-600 text-gray-100" },
};

function badge(status: string) {
  const s = STATUS_LABEL[status] ?? { label: status, color: "bg-gray-700 text-gray-200" };
  return (
    <span
      className={`inline-block text-xs font-mono font-bold px-1 rounded ${s.color}`}
    >
      {s.label}
    </span>
  );
}

interface GitChangesProps {
  changes: GitChange[];
  loading: boolean;
  error: string | null;
}

export default function GitChanges({ changes, loading, error }: GitChangesProps) {
  const openFile = useStore((s) => s.openFile);

  if (loading) {
    return <div className="p-3 text-gray-400 text-sm">Loading changes…</div>;
  }
  if (error) {
    const isNoRepo =
      error.toLowerCase().includes("not a git") ||
      error.toLowerCase().includes("invalid git") ||
      error.toLowerCase().includes("no such file") ||
      error.toLowerCase().includes("gitrepository") ||
      error.toLowerCase().includes("git repo not found");
    return (
      <div className="p-4 text-sm flex flex-col gap-2">
        {isNoRepo ? (
          <>
            <p className="text-yellow-400 font-medium">No git repository found</p>
            <p className="text-gray-400 text-xs">
              The current folder is not a git repository. Open a folder that
              contains a <code className="bg-gray-700 px-1 rounded">.git</code> directory
              to see changed files.
            </p>
          </>
        ) : (
          <p className="text-red-400">{error}</p>
        )}
      </div>
    );
  }
  if (changes.length === 0) {
    return (
      <div className="p-3 text-gray-500 text-sm">
        No changed files detected.
      </div>
    );
  }

  return (
    <div className="monaco-like-scrollbar overflow-y-auto h-full py-1">
      {changes.map((c) => (
        <button
          key={c.path}
          onClick={() => openFile(c.path, c.status === "D" ? "view" : "diff")}
          className="flex items-center gap-2 w-full text-left px-3 py-1 hover:bg-gray-700 rounded text-sm text-gray-200 truncate"
          title={c.path}
        >
          {badge(c.status)}
          <span className="truncate">{c.path}</span>
        </button>
      ))}
    </div>
  );
}
