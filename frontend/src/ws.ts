import { useEffect, useRef } from "react";
import type {
  AgentNoticePayload,
  Comment,
  DeleteCommentPayload,
  HighlightPayload,
  LeftTab,
  McpSessionPayload,
  OpenFilePayload,
  WsEvent,
} from "./types";
import { useStore } from "./store";

function getWsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws`;
}

export function useWebSocket(): void {
  const wsRef = useRef<WebSocket | null>(null);
  const store = useStore();

  useEffect(() => {
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const ws = new WebSocket(getWsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[WS] Connected");
      };

      ws.onmessage = (event) => {
        let evt: WsEvent;
        try {
          evt = JSON.parse(event.data as string) as WsEvent;
        } catch {
          return;
        }

        switch (evt.type) {
          case "open_file": {
            const p = evt.payload as OpenFilePayload;
            store.openFileFromServer(p.path, p.mode ?? "view");
            break;
          }
          case "add_comment": {
            const c = evt.payload as Comment;
            store.addComment(c);
            break;
          }
          case "delete_comment": {
            const d = evt.payload as DeleteCommentPayload;
            store.removeComment(d.id);
            break;
          }
          case "highlight": {
            const h = evt.payload as HighlightPayload;
            // Open the file first (in view mode) then highlight
            store.openFile(h.path, "view");
            store.setActiveHighlight(h);
            break;
          }
          case "refresh_comments": {
            // Server signals a full refresh — replace all comments
            const comments = evt.payload as Comment[];
            if (Array.isArray(comments)) {
              store.setComments(comments);
            }
            break;
          }
          case "refresh_files": {
            // Server signals a file tree update — bump version to re-fetch
            store.bumpFilesVersion();
            break;
          }
          case "close_file": {
            store.closeFile();
            break;
          }
          case "set_left_tab": {
            const tab = (evt.payload as { tab: LeftTab }).tab;
            if (tab === "files" || tab === "git") {
              store.setActiveTab(tab);
            }
            break;
          }
          case "agent_notice": {
            const n = evt.payload as AgentNoticePayload;
            if (n?.message) {
              store.setAgentNotice(n.message);
            }
            break;
          }
          case "mcp_session": {
            const m = evt.payload as McpSessionPayload;
            if (m?.coding_agent) {
              store.setMcpSession({
                coding_agent: m.coding_agent,
                model_name: m.model_name ?? "",
                client_version: m.client_version ?? "",
              });
            }
            break;
          }
        }
      };

      ws.onclose = () => {
        console.log("[WS] Disconnected — reconnecting in 3s…");
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
