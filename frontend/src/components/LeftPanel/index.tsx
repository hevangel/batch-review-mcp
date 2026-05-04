import { useCallback, useEffect, useRef, useState } from "react";
import type { FileInfo, GitChange, GitCompareParams, LeftTab } from "../../types";
import { listFiles, getGitChanges } from "../../api";
import { useStore } from "../../store";
import FileExplorer from "./FileExplorer";
import GitChanges from "./GitChanges";
import { PANEL_BOTTOM_BAR_CLASS } from "../ui/panelBottomBar";
import { IconMoon, IconRefresh, IconSun, toolbarBtnNeutral, toolbarIconClass } from "../ui/toolbarIcons";

const INITIAL_FILE_TREE_DEPTH = 2;
const BACKGROUND_FILE_TREE_DEPTH = 1;

function mergeDirectoryChildren(nodes: FileInfo[], path: string, children: FileInfo[]): FileInfo[] {
  return nodes.map((node) => {
    if (node.path === path) {
      return {
        ...node,
        children,
        children_loaded: true,
        has_children: children.length > 0,
      };
    }
    if (node.children) {
      return {
        ...node,
        children: mergeDirectoryChildren(node.children, path, children),
      };
    }
    return node;
  });
}

function findNode(nodes: FileInfo[], path: string): FileInfo | null {
  for (const node of nodes) {
    if (node.path === path) {
      return node;
    }
    if (node.children) {
      const found = findNode(node.children, path);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

function collectUnloadedDirectoryPaths(nodes: FileInfo[], out: string[] = []): string[] {
  for (const node of nodes) {
    if (node.is_dir && (node.has_children ?? true)) {
      if (node.children_loaded === false) {
        out.push(node.path);
      }
      if (node.children) {
        collectUnloadedDirectoryPaths(node.children, out);
      }
    }
  }
  return out;
}

function waitForIdleSlice(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 25));
}

export default function LeftPanel() {
  const mcpSession = useStore((s) => s.mcpSession);
  const theme = useStore((s) => s.theme);
  const toggleTheme = useStore((s) => s.toggleTheme);
  const activeTab = useStore((s) => s.activeTab);
  const setActiveTab = useStore((s) => s.setActiveTab);
  const filesVersion = useStore((s) => s.filesVersion);
  const gitCompare = useStore((s) => s.gitCompare);
  const setGitCompare = useStore((s) => s.setGitCompare);

  const [files, setFiles] = useState<FileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(true);
  const [filesBackgroundLoading, setFilesBackgroundLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);
  const [loadingFilePaths, setLoadingFilePaths] = useState<Set<string>>(new Set());
  const filesRef = useRef<FileInfo[]>([]);
  const loadingFilePathsRef = useRef<Set<string>>(new Set());
  const filesRequestGenerationRef = useRef(0);

  const [changes, setChanges] = useState<GitChange[]>([]);
  const [changesLoading, setChangesLoading] = useState(false);
  const [changesError, setChangesError] = useState<string | null>(null);
  const [commitBase, setCommitBase] = useState("HEAD~1");
  const [prInput, setPrInput] = useState("");

  const setFilesAndRef = useCallback((updater: FileInfo[] | ((current: FileInfo[]) => FileInfo[])) => {
    setFiles((current) => {
      const next = typeof updater === "function" ? updater(current) : updater;
      filesRef.current = next;
      return next;
    });
  }, []);

  const setDirectoryLoading = useCallback((path: string, loading: boolean) => {
    const next = new Set(loadingFilePathsRef.current);
    if (loading) {
      next.add(path);
    } else {
      next.delete(path);
    }
    loadingFilePathsRef.current = next;
    setLoadingFilePaths(next);
  }, []);

  const loadDirectory = useCallback(async (
    path: string,
    maxDepth = BACKGROUND_FILE_TREE_DEPTH,
    generation = filesRequestGenerationRef.current,
    quiet = false,
  ): Promise<FileInfo[]> => {
    if (loadingFilePathsRef.current.has(path)) {
      return [];
    }
    setDirectoryLoading(path, true);
    try {
      const data = await listFiles(path, maxDepth);
      if (generation !== filesRequestGenerationRef.current) {
        return data;
      }
      setFilesAndRef((current) => mergeDirectoryChildren(current, path, data));
      if (!quiet) {
        setFilesError(null);
      }
      return data;
    } catch (e) {
      if (!quiet) {
        setFilesError(e instanceof Error ? e.message : String(e));
      }
      return [];
    } finally {
      setDirectoryLoading(path, false);
    }
  }, [setDirectoryLoading, setFilesAndRef]);

  const hydrateDeeperDirectories = useCallback(async (seed: FileInfo[], generation: number) => {
    const queue = collectUnloadedDirectoryPaths(seed);
    if (queue.length === 0) {
      return;
    }

    setFilesBackgroundLoading(true);
    try {
      while (queue.length > 0 && generation === filesRequestGenerationRef.current) {
        const path = queue.shift();
        if (!path) {
          continue;
        }
        const currentNode = findNode(filesRef.current, path);
        if (!currentNode || currentNode.children_loaded !== false) {
          continue;
        }

        const children = await loadDirectory(path, BACKGROUND_FILE_TREE_DEPTH, generation, true);
        queue.push(...collectUnloadedDirectoryPaths(children));
        await waitForIdleSlice();
      }
    } finally {
      if (generation === filesRequestGenerationRef.current) {
        setFilesBackgroundLoading(false);
      }
    }
  }, [loadDirectory]);

  const loadInitialFiles = useCallback(() => {
    const generation = filesRequestGenerationRef.current + 1;
    filesRequestGenerationRef.current = generation;
    loadingFilePathsRef.current = new Set();
    setLoadingFilePaths(new Set());
    setFilesBackgroundLoading(false);
    setFilesLoading(true);

    listFiles(".", INITIAL_FILE_TREE_DEPTH)
      .then((data) => {
        if (generation !== filesRequestGenerationRef.current) {
          return;
        }
        setFilesAndRef(data);
        setFilesError(null);
        void hydrateDeeperDirectories(data, generation);
      })
      .catch((e: Error) => setFilesError(e.message))
      .finally(() => {
        if (generation === filesRequestGenerationRef.current) {
          setFilesLoading(false);
        }
      });
  }, [hydrateDeeperDirectories, setFilesAndRef]);

  useEffect(() => {
    loadInitialFiles();
  }, [filesVersion, loadInitialFiles]);

  const handleTabChange = (tab: LeftTab) => {
    setActiveTab(tab);
  };

  const loadGitChanges = useCallback((compare: GitCompareParams) => {
    setChangesLoading(true);
    getGitChanges(compare)
      .then((data) => {
        setChanges(data);
        setChangesError(null);
      })
      .catch((e: Error) => setChangesError(e.message))
      .finally(() => setChangesLoading(false));
  }, []);

  // Load git changes whenever the Git tab or compare context changes.
  useEffect(() => {
    if (activeTab !== "git") return;
    let cancelled = false;
    setChangesLoading(true);
    getGitChanges(gitCompare)
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
  }, [activeTab, gitCompare]);

  const refreshFiles = () => {
    loadInitialFiles();
  };

  const refreshGit = () => {
    loadGitChanges(gitCompare);
  };

  const applyCommitCompare = () => {
    const base = commitBase.trim();
    if (!base) {
      setChangesError("Enter a previous commit or ref to compare.");
      return;
    }
    setGitCompare({ mode: "commit", base, head: "HEAD" });
  };

  const applyPrCompare = () => {
    const pr = prInput.trim();
    if (!pr) {
      setChangesError("Enter a PR number or URL to compare.");
      return;
    }
    setGitCompare({ mode: "pr", pr });
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
            type="button"
            onClick={refreshFiles}
            title="Refresh file tree"
            className="px-2 text-gray-400 hover:text-gray-200"
          >
            <IconRefresh className={toolbarIconClass} />
          </button>
        )}
        {activeTab === "git" && (
          <button
            type="button"
            onClick={refreshGit}
            title="Refresh git status"
            className="px-2 text-gray-400 hover:text-gray-200"
          >
            <IconRefresh className={toolbarIconClass} />
          </button>
        )}
        <button
          type="button"
          onClick={toggleTheme}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          className={`${toolbarBtnNeutral} my-1 mr-1 px-1.5`}
        >
          {theme === "dark" ? (
            <IconSun className={toolbarIconClass} />
          ) : (
            <IconMoon className={toolbarIconClass} />
          )}
        </button>
      </div>

      {/* Panel content */}
      <div className="flex-1 overflow-hidden min-h-0">
        {activeTab === "files" ? (
          <FileExplorer
            files={files}
            loading={filesLoading}
            backgroundLoading={filesBackgroundLoading}
            error={filesError}
            loadingPaths={loadingFilePaths}
            onLoadDirectory={(path) => {
              void loadDirectory(path);
            }}
          />
        ) : (
          <div className="flex h-full min-h-0 flex-col">
            <div className="border-b border-gray-700 p-2 text-xs">
              <div className="mb-2 grid grid-cols-3 gap-1">
                <button
                  type="button"
                  onClick={() => setGitCompare({ mode: "local" })}
                  className={`${toolbarBtnNeutral} justify-center ${gitCompare.mode === "local" ? "bg-blue-700 hover:bg-blue-600" : ""}`}
                >
                  Local
                </button>
                <button
                  type="button"
                  onClick={applyCommitCompare}
                  className={`${toolbarBtnNeutral} justify-center ${gitCompare.mode === "commit" ? "bg-blue-700 hover:bg-blue-600" : ""}`}
                >
                  Commit
                </button>
                <button
                  type="button"
                  onClick={applyPrCompare}
                  className={`${toolbarBtnNeutral} justify-center ${gitCompare.mode === "pr" ? "bg-blue-700 hover:bg-blue-600" : ""}`}
                >
                  PR
                </button>
              </div>
              <div className="space-y-1.5">
                <label className="block">
                  <span className="mb-1 block text-gray-400">Previous commit/ref</span>
                  <div className="flex gap-1">
                    <input
                      value={commitBase}
                      onChange={(e) => setCommitBase(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") applyCommitCompare();
                      }}
                      className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-gray-100 focus:border-blue-500 focus:outline-none"
                      placeholder="HEAD~1"
                    />
                    <button type="button" onClick={applyCommitCompare} className={toolbarBtnNeutral}>
                      Go
                    </button>
                  </div>
                </label>
                <label className="block">
                  <span className="mb-1 block text-gray-400">PR number or URL</span>
                  <div className="flex gap-1">
                    <input
                      value={prInput}
                      onChange={(e) => setPrInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") applyPrCompare();
                      }}
                      className="min-w-0 flex-1 rounded border border-gray-600 bg-gray-700 px-2 py-1 text-gray-100 focus:border-blue-500 focus:outline-none"
                      placeholder="123 or GitHub PR URL"
                    />
                    <button type="button" onClick={applyPrCompare} className={toolbarBtnNeutral}>
                      Go
                    </button>
                  </div>
                </label>
                <p className="truncate text-gray-500" title={JSON.stringify(gitCompare)}>
                  {gitCompare.mode === "local"
                    ? "Local changes vs HEAD"
                    : gitCompare.mode === "commit"
                    ? `${gitCompare.base ?? "base"} → HEAD`
                    : `Current checkout → ${gitCompare.pr ?? "PR"}`}
                </p>
              </div>
            </div>
            <GitChanges
              changes={changes}
              loading={changesLoading}
              error={changesError}
            />
          </div>
        )}
      </div>

      <div className={PANEL_BOTTOM_BAR_CLASS}>
        <div className="min-w-0 flex-1 text-xs leading-snug">
          {mcpSession ? (
            <p className="truncate" title={`${mcpSession.coding_agent}${mcpSession.model_name ? ` — ${mcpSession.model_name}` : ""}${mcpSession.client_version ? ` (${mcpSession.client_version})` : ""}`}>
              <span className="text-gray-200 font-medium">{mcpSession.coding_agent}</span>
              {mcpSession.model_name ? (
                <span className="text-gray-400"> · {mcpSession.model_name}</span>
              ) : null}
            </p>
          ) : (
            <p className="text-gray-500 truncate" title="Call init_batch_review_session from your MCP client">
              No MCP session yet
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
