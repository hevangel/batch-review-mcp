import { useEffect, useState } from "react";
import type { FileInfo, GitChange, LeftTab } from "../../types";
import { listFiles, getGitChanges } from "../../api";
import { useStore } from "../../store";
import FileExplorer from "./FileExplorer";
import GitChanges from "./GitChanges";

export default function LeftPanel() {
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const filesVersion = useStore((s) => s.filesVersion);

  const [files, setFiles] = useState<FileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesError, setFilesError] = useState<string | null>(null);

  const [changes, setChanges] = useState<GitChange[]>([]);
  const [changesLoading, setChangesLoading] = useState(false);
  const [changesError, setChangesError] = useState<string | null>(null);

  useEffect(() => {
    setFilesLoading(true);
    listFiles(".")
      .then((data) => {
        setFiles(data);
        setFilesError(null);
      })
      .catch((e: Error) => setFilesError(e.message))
      .finally(() => setFilesLoading(false));
  }, [filesVersion]);

  const handleTabChange = (tab: LeftTab) => {
    setActiveTab(tab);
  };

  // Load git changes whenever the Git tab is active.
  useEffect(() => {
    if (activeTab !== "git") return;
    let cancelled = false;
    setChangesLoading(true);
    getGitChanges()
      .then((data) => {
        if (!cancelled) {
          setChanges(data);
          setChangesError(null);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setChangesError(e.message);
      })
      .finally(() => {
        if (!cancelled) setChangesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const refreshFiles = () => {
    setFilesLoading(true);
    listFiles(".")
      .then((data) => {
        setFiles(data);
        setFilesError(null);
      })
      .catch((e: Error) => setFilesError(e.message))
      .finally(() => setFilesLoading(false));
  };

  const refreshGit = () => {
    setChangesLoading(true);
    getGitChanges()
      .then((data) => {
        setChanges(data);
        setChangesError(null);
      })
      .catch((e: Error) => setChangesError(e.message))
      .finally(() => setChangesLoading(false));
  };

  return (
    <div className="flex flex-col h-full bg-gray-800 border-r border-gray-700">
      {/* Tab bar */}
      <div className="flex border-b border-gray-700 shrink-0">
        <button
          onClick={() => handleTabChange("files")}
          className={`flex-1 px-3 py-2 text-sm font-medium ${
            activeTab === "files"
              ? "text-white border-b-2 border-blue-400"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          Files
        </button>
        <button
          onClick={() => handleTabChange("git")}
          className={`flex-1 px-3 py-2 text-sm font-medium ${
            activeTab === "git"
              ? "text-white border-b-2 border-blue-400"
              : "text-gray-400 hover:text-gray-200"
          }`}
        >
          Git
        </button>
        {activeTab === "files" && (
          <button
            onClick={refreshFiles}
            title="Refresh file tree"
            className="px-2 text-gray-400 hover:text-gray-200 text-lg"
          >
            ↻
          </button>
        )}
        {activeTab === "git" && (
          <button
            onClick={refreshGit}
            title="Refresh git status"
            className="px-2 text-gray-400 hover:text-gray-200 text-lg"
          >
            ↻
          </button>
        )}
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === "files" ? (
          <FileExplorer
            files={files}
            loading={filesLoading}
            error={filesError}
          />
        ) : (
          <GitChanges
            changes={changes}
            loading={changesLoading}
            error={changesError}
          />
        )}
      </div>
    </div>
  );
}
