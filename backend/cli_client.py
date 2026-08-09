"""Batch Review CLI client.

A token-efficient command-line client for coding agents. Instead of loading ~18 MCP
tool schemas into agent context, the agent invokes ``batch-review <verb>`` via its
shell tool — one process per operation, emitting a single JSON document to stdout.

The CLI talks to a running Batch Review server over REST. Because the REST endpoints
broadcast to WebSocket clients, every comment / open-file / highlight action also
updates the human reviewer's browser UI in real time.

Server discovery (priority order):
  1. ``BATCH_REVIEW_WEB_URL`` environment variable
  2. ``<repo_root>/.batch_review/server.json`` port file (written by ``start``)
  3. Probe ports 9000–9999 on localhost

Output contract:
  - JSON payload on stdout (one document per invocation)
  - Progress / human messages on stderr
  - Non-zero exit code on error (so agents can detect failure)
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import subprocess
import sys
import time
import urllib.parse
from pathlib import Path

from backend.local_url_guard import LocalUrlError, local_request

# Default port the server binds (matches main.py _find_free_port default).
_DEFAULT_PORT = 9000
_PORT_SCAN_END = 10000  # exclusive upper bound for discovery scan
_PORT_SCAN_LIMIT = 20   # don't scan forever
_SERVER_STARTUP_TIMEOUT = 20  # seconds to wait for a spawned server to bind

# Directory written by ``start`` so other verbs can discover the running server.
_PORT_DIR_NAME = ".batch_review"
_PORT_FILE_NAME = "server.json"


# ---------------------------------------------------------------------------
# Server discovery
# ---------------------------------------------------------------------------

def _port_file_path(repo_root: Path) -> Path:
    """Return the path to the server discovery file for *repo_root*."""
    return repo_root / _PORT_DIR_NAME / _PORT_FILE_NAME


def _read_port_file(repo_root: Path) -> str | None:
    """Read the base URL from ``<repo_root>/.batch_review/server.json``."""
    pf = _port_file_path(repo_root)
    if not pf.is_file():
        return None
    try:
        data = json.loads(pf.read_text(encoding="utf-8"))
        base = data.get("web_url")
        return base if isinstance(base, str) and base else None
    except (json.JSONDecodeError, OSError):
        return None


def _write_port_file(repo_root: Path, web_url: str, pid: int, port: int) -> None:
    """Persist server connection details so other verbs can find it."""
    pf = _port_file_path(repo_root)
    pf.parent.mkdir(parents=True, exist_ok=True)
    pf.write_text(
        json.dumps(
            {"web_url": web_url, "pid": pid, "port": port, "started_at": time.time()},
            indent=2,
        ),
        encoding="utf-8",
    )


def _remove_port_file(repo_root: Path) -> None:
    """Remove the port file if it exists."""
    pf = _port_file_path(repo_root)
    try:
        pf.unlink(missing_ok=True)
    except OSError:
        pass


def _probe_url(base_url: str, timeout: float = 1.5) -> bool:
    """Return True if *base_url* is a running Batch Review server.

    We verify by hitting ``/api/config`` and checking that it returns valid
    JSON — a plain HTTP 200 from any unrelated service (e.g. ASUS Armoury
    Crate) would pass a bare connectivity check but will fail here because
    it won't return a JSON object on that path.

    The request goes through :func:`backend.local_url_guard.local_request`,
    which refuses any URL that does not resolve to a loopback/private address.
    """
    try:
        status, raw = local_request(f"{base_url}/api/config", timeout=timeout)
    except (LocalUrlError, OSError):
        return False
    if status != 200:
        return False
    try:
        json.loads(raw)
        return True
    except Exception:
        return False


def _scan_for_server() -> str | None:
    """Probe localhost ports 9000–9999 for a running Batch Review server."""
    for i, port in enumerate(range(_DEFAULT_PORT, _PORT_SCAN_END)):
        if i >= _PORT_SCAN_LIMIT:
            break
        candidate = f"http://127.0.0.1:{port}"
        if _probe_url(candidate, timeout=0.4):
            return candidate
    return None


def discover_server(repo_root: Path) -> str | None:
    """Find a running Batch Review server base URL, or return None.

    Discovery order:
      1. ``BATCH_REVIEW_WEB_URL`` env var
      2. ``<repo_root>/.batch_review/server.json``
      3. Probe localhost ports 9000+
    """
    env_url = os.environ.get("BATCH_REVIEW_WEB_URL")
    if env_url and _probe_url(env_url, timeout=2.0):
        return env_url.rstrip("/")

    pf_url = _read_port_file(repo_root)
    if pf_url and _probe_url(pf_url, timeout=2.0):
        return pf_url.rstrip("/")

    return _scan_for_server()


def require_server(repo_root: Path) -> str:
    """Like :func:`discover_server` but exits with a helpful message if none found."""
    base = discover_server(repo_root)
    if base:
        return base
    print(
        json.dumps(
            {
                "error": "No Batch Review server found.",
                "hint": "Start one with: batch-review start --root "
                + str(repo_root),
            }
        ),
        file=sys.stdout,
    )
    sys.exit(1)


# ---------------------------------------------------------------------------
# HTTP client (routed through local_request — zero extra dependencies)
# ---------------------------------------------------------------------------

def _api(
    base_url: str,
    path: str,
    method: str = "GET",
    body: dict | None = None,
    timeout: float = 30.0,
):
    """Call a REST endpoint and return the parsed JSON response.

    Raises ``SystemExit`` on HTTP errors so the agent gets a clear JSON error.
    The request is made via :func:`backend.local_url_guard.local_request`,
    which refuses any server URL that does not resolve to a local address.
    """
    url = f"{base_url}{path}"
    data = json.dumps(body).encode() if body is not None else None
    headers = {"Content-Type": "application/json"} if data else None
    try:
        status, raw = local_request(
            url, method=method, body=data, headers=headers, timeout=timeout
        )
    except LocalUrlError as exc:
        print(json.dumps({"error": f"Refusing non-local server URL: {exc}"}))
        sys.exit(1)
    except OSError as exc:
        print(
            json.dumps(
                {
                    "error": f"Cannot connect to {url}: {exc}",
                    "hint": "Is the server running? Try: batch-review start --root .",
                }
            )
        )
        sys.exit(1)

    if status not in (200, 201, 204):
        print(json.dumps({"error": f"HTTP {status}", "detail": raw.decode(errors="replace")}))
        sys.exit(1)

    if status == 204 or not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return {"raw": raw.decode("utf-8", errors="replace")}


# ---------------------------------------------------------------------------
# Lifecycle verbs: start / stop
# ---------------------------------------------------------------------------

def _python_or_uv_command() -> list[str]:
    """Return the command prefix to launch a Batch Review server process.

    Prefer ``batch-review`` (the installed console script). Fall back to
    ``python main.py`` if running from a source checkout without install.
    """
    # When running via ``uv run``, sys.executable is the venv python and
    # ``batch-review`` is on PATH.
    here = Path(__file__).resolve().parent.parent  # repo root
    main_py = here / "main.py"
    if main_py.is_file():
        return [sys.executable, str(main_py)]
    # Fallback: assume batch-review is installed globally / in venv
    return ["batch-review"]


def _wait_for_server(base_url: str, timeout: int = _SERVER_STARTUP_TIMEOUT) -> bool:
    """Poll *base_url* until it responds or timeout expires."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        if _probe_url(base_url, timeout=1.0):
            return True
        time.sleep(0.5)
    return False


def _read_actual_port(port_file: Path, retries: int = 40, delay: float = 0.5) -> dict | None:
    """Wait for the spawned server to write its port file, then return its contents."""
    for _ in range(retries):
        if port_file.is_file():
            try:
                return json.loads(port_file.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
        time.sleep(delay)
    return None


def cmd_start(args: argparse.Namespace) -> None:
    """Start a Batch Review server in the background (detached)."""
    repo_root = Path(args.root).resolve()
    if not repo_root.is_dir():
        print(json.dumps({"error": f"Repository root does not exist: {repo_root}"}))
        sys.exit(1)

    # If a server is already running for this repo, report it.
    existing = discover_server(repo_root)
    if existing:
        print(json.dumps({"web_url": existing, "already_running": True}))
        return

    # Probe the preferred port; the server auto-increments if busy, but we want to
    # pass a likely-free port so the port file is predictable.
    port = args.port
    port_file = _port_file_path(repo_root)

    cmd = _python_or_uv_command()
    # Build the server launch args (legacy flag interface).
    cmd += [
        "--root", str(repo_root),
        "--port", str(port),
        "--skip-build",
    ]
    if args.no_browser:
        cmd += ["--no-browser"]

    print(f"Starting Batch Review server on port {port}…", file=sys.stderr)

    # Detach so the server survives this CLI process exiting.
    creationflags = 0
    if os.name == "nt":
        # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
        creationflags = 0x00000008 | 0x00000200
    try:
        proc = subprocess.Popen(  # noqa: S603 — cmd is constructed internally
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            stdin=subprocess.DEVNULL,
            creationflags=creationflags,
            cwd=str(repo_root),
            close_fds=True,
        )
    except FileNotFoundError as exc:
        print(json.dumps({"error": f"Cannot launch server: {exc}"}))
        sys.exit(1)

    # Wait for the server to write its port file (the server sets
    # BATCH_REVIEW_WEB_URL and calls set_web_app_url, but we need the *actual*
    # bound port since it may auto-increment).
    info = _read_actual_port(port_file, retries=40, delay=0.5)
    if info and info.get("web_url"):
        web_url = info["web_url"]
    else:
        # Port file not written — fall back to probing the preferred port range.
        web_url = f"http://127.0.0.1:{port}"
        if not _wait_for_server(web_url, timeout=10):
            _remove_port_file(repo_root)
            print(
                json.dumps(
                    {
                        "error": "Server did not become reachable in time.",
                        "pid": proc.pid,
                        "hint": "Check stderr from the server process or try a different --port.",
                    }
                )
            )
            sys.exit(1)

    # The server itself writes the port file when it binds, but also update it
    # with the PID of the process we spawned (in case the server's self-write
    # lacks the pid or used a different repo_root resolution).
    _write_port_file(repo_root, web_url, proc.pid, port)

    print(json.dumps({"web_url": web_url, "pid": proc.pid, "port": port}))


def cmd_stop(args: argparse.Namespace) -> None:
    """Stop a running Batch Review server for *repo_root*."""
    repo_root = Path(args.root).resolve()
    port_file = _port_file_path(repo_root)

    info = None
    if port_file.is_file():
        try:
            info = json.loads(port_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass

    pid = info.get("pid") if info else None

    if pid:
        try:
            if os.name == "nt":
                subprocess.run(  # noqa: S603, S607
                    ["taskkill", "/PID", str(pid), "/F", "/T"],
                    capture_output=True,
                    timeout=10,
                )
            else:
                import signal

                os.kill(pid, signal.SIGTERM)
        except (ProcessLookupError, PermissionError, OSError, subprocess.TimeoutExpired):
            pass  # Process may have already exited

    _remove_port_file(repo_root)
    print(json.dumps({"stopped": True, "pid": pid}))


# ---------------------------------------------------------------------------
# Read-only review verbs
# ---------------------------------------------------------------------------

def cmd_config(args: argparse.Namespace) -> None:
    base = require_server(Path(args.root).resolve())
    print(json.dumps(_api(base, "/api/config")))


def cmd_url(args: argparse.Namespace) -> None:
    """Return connection URLs (web UI, websocket, MCP HTTP)."""
    base = require_server(Path(args.root).resolve())
    config = _api(base, "/api/config")
    web_url = config.get("web_ui_url") or base
    ws = web_url.replace("http://", "ws://", 1).replace("https://", "wss://", 1) + "/ws"
    print(json.dumps({"web_ui": web_url, "websocket": ws, "mcp_http": f"{web_url}/mcp"}))


def cmd_changes(args: argparse.Namespace) -> None:
    base = require_server(Path(args.root).resolve())
    params = f"?mode={args.mode}"
    if args.base:
        params += f"&base={urllib.parse.quote(args.base)}"
    if args.head:
        params += f"&head={urllib.parse.quote(args.head)}"
    if args.pr:
        params += f"&pr={urllib.parse.quote(args.pr)}"
    print(json.dumps(_api(base, f"/api/git/changes{params}")))


def cmd_diff(args: argparse.Namespace) -> None:
    base = require_server(Path(args.root).resolve())
    params = f"?path={urllib.parse.quote(args.path, safe='')}"
    if args.mode != "local":
        params += f"&mode={args.mode}"
    if args.base:
        params += f"&base={urllib.parse.quote(args.base)}"
    if args.head:
        params += f"&head={urllib.parse.quote(args.head)}"
    if args.pr:
        params += f"&pr={urllib.parse.quote(args.pr)}"
    print(json.dumps(_api(base, f"/api/git/diff{params}")))


def cmd_ls(args: argparse.Namespace) -> None:
    base = require_server(Path(args.root).resolve())
    params = ""
    if args.path:
        params = f"?path={urllib.parse.quote(args.path, safe='')}"
    if args.depth is not None:
        sep = "&" if params else "?"
        params += f"{sep}max_depth={args.depth}"
    print(json.dumps(_api(base, f"/api/files{params}")))


def cmd_file(args: argparse.Namespace) -> None:
    base = require_server(Path(args.root).resolve())
    print(
        json.dumps(
            _api(base, f"/api/file-content?path={urllib.parse.quote(args.path, safe='')}")
        )
    )


def cmd_list_comments(args: argparse.Namespace) -> None:
    base = require_server(Path(args.root).resolve())
    print(json.dumps(_api(base, "/api/comments")))


def cmd_list_reviews(args: argparse.Namespace) -> None:
    base = require_server(Path(args.root).resolve())
    print(json.dumps(_api(base, "/api/review-files")))


# ---------------------------------------------------------------------------
# Mutation verbs
# ---------------------------------------------------------------------------

def cmd_add_comment(args: argparse.Namespace) -> None:
    base = require_server(Path(args.root).resolve())
    body: dict = {
        "file_path": args.path,
        "line_start": args.line_start,
        "line_end": args.line_end,
        "text": args.text,
    }
    if args.highlighted:
        body["highlighted_text"] = args.highlighted
    print(json.dumps(_api(base, "/api/comments", method="POST", body=body)))


def cmd_update_comment(args: argparse.Namespace) -> None:
    base = require_server(Path(args.root).resolve())
    print(
        json.dumps(
            _api(
                base,
                f"/api/comments/{urllib.parse.quote(args.id, safe='')}",
                method="PATCH",
                body={"text": args.text},
            )
        )
    )


def cmd_delete_comment(args: argparse.Namespace) -> None:
    base = require_server(Path(args.root).resolve())
    _api(base, f"/api/comments/{urllib.parse.quote(args.id, safe='')}", method="DELETE")
    print(json.dumps({"deleted": True, "id": args.id}))


def cmd_clear(args: argparse.Namespace) -> None:
    base = require_server(Path(args.root).resolve())
    _api(base, "/api/comments/clear", method="DELETE")
    print(json.dumps({"cleared": True}))


def cmd_delete_outdated(args: argparse.Namespace) -> None:
    base = require_server(Path(args.root).resolve())
    result = _api(base, "/api/comments/outdated", method="DELETE")
    print(json.dumps({"remaining": result}))


def cmd_recompute_stale(args: argparse.Namespace) -> None:
    base = require_server(Path(args.root).resolve())
    print(json.dumps(_api(base, "/api/comments/recompute-stale", method="POST")))


def cmd_save(args: argparse.Namespace) -> None:
    base = require_server(Path(args.root).resolve())
    body: dict = {}
    if args.stem:
        body["output_stem"] = args.stem
    if args.dir:
        body["output_dir"] = args.dir
    print(json.dumps(_api(base, "/api/comments/save", method="POST", body=body)))


def cmd_load(args: argparse.Namespace) -> None:
    base = require_server(Path(args.root).resolve())
    print(
        json.dumps(
            _api(base, "/api/comments/load", method="POST", body={"stem": args.stem})
        )
    )


# ---------------------------------------------------------------------------
# UI control verbs (require the new /api/ui/* endpoints)
# ---------------------------------------------------------------------------

def cmd_open(args: argparse.Namespace) -> None:
    base = require_server(Path(args.root).resolve())
    print(
        json.dumps(
            _api(
                base,
                "/api/ui/open",
                method="POST",
                body={"path": args.path, "mode": args.mode},
            )
        )
    )


def cmd_highlight(args: argparse.Namespace) -> None:
    base = require_server(Path(args.root).resolve())
    body: dict = {
        "path": args.path,
        "line_start": args.line_start,
        "line_end": args.line_end,
    }
    print(json.dumps(_api(base, "/api/ui/highlight", method="POST", body=body)))


def cmd_jump(args: argparse.Namespace) -> None:
    base = require_server(Path(args.root).resolve())
    print(
        json.dumps(
            _api(
                base,
                "/api/ui/jump",
                method="POST",
                body={"comment_id": args.comment_id},
            )
        )
    )


def cmd_init_session(args: argparse.Namespace) -> None:
    """Register this CLI client with the server (mirrors init_batch_review_session)."""
    base = require_server(Path(args.root).resolve())
    body: dict = {"coding_agent": args.agent or "batch-review-cli"}
    if args.model:
        body["model_name"] = args.model
    if args.version:
        body["client_version"] = args.version
    print(json.dumps(_api(base, "/api/session/init", method="POST", body=body)))


# ---------------------------------------------------------------------------
# Argparse dispatch
# ---------------------------------------------------------------------------

# Ordered list of all CLI verb names — exported so main.py can detect them.
CLI_VERBS = [
    "start", "stop",
    "config", "url", "changes", "diff", "ls", "file",
    "add-comment", "list-comments", "update-comment", "delete-comment",
    "clear", "delete-outdated", "recompute-stale",
    "save", "load", "list-reviews",
    "open", "highlight", "jump", "init-session",
]

_VERB_ALIASES = {
    # Friendly shortcuts
    "comments": "list-comments",
    "reviews": "list-reviews",
}


def _add_root_arg(p: argparse.ArgumentParser) -> None:
    p.add_argument("--root", default=os.getcwd(), help="Repository root (default: cwd)")


def build_parser() -> argparse.ArgumentParser:
    """Build the argparse parser for the CLI client subcommands."""
    parser = argparse.ArgumentParser(
        prog="batch-review",
        description="Batch Review CLI — token-efficient review client for coding agents.",
    )
    sub = parser.add_subparsers(dest="verb", required=True)

    # start
    p = sub.add_parser("start", help="Start a Batch Review server in the background.")
    _add_root_arg(p)
    p.add_argument("--port", type=int, default=_DEFAULT_PORT, help="Preferred port.")
    p.add_argument("--no-browser", action="store_true", help="Don't open the browser.")
    p.set_defaults(func=cmd_start)

    # stop
    p = sub.add_parser("stop", help="Stop a running Batch Review server.")
    _add_root_arg(p)
    p.set_defaults(func=cmd_stop)

    # config
    p = sub.add_parser("config", help="Show server configuration.")
    _add_root_arg(p)
    p.set_defaults(func=cmd_config)

    # url
    p = sub.add_parser("url", help="Show connection URLs (web UI, websocket, MCP HTTP).")
    _add_root_arg(p)
    p.set_defaults(func=cmd_url)

    # changes
    p = sub.add_parser("changes", help="List changed files (git diff vs HEAD/commit/PR).")
    _add_root_arg(p)
    p.add_argument("--mode", choices=["local", "commit", "pr"], default="local")
    p.add_argument("--base", default=None, help="Base ref (for --mode commit).")
    p.add_argument("--head", default=None, help="Head ref.")
    p.add_argument("--pr", default=None, help="PR number or URL (for --mode pr).")
    p.set_defaults(func=cmd_changes)

    # diff
    p = sub.add_parser("diff", help="Show unified diff for a file.")
    _add_root_arg(p)
    p.add_argument("path", help="File path relative to repo root.")
    p.add_argument("--mode", choices=["local", "commit", "pr"], default="local")
    p.add_argument("--base", default=None)
    p.add_argument("--head", default=None)
    p.add_argument("--pr", default=None)
    p.set_defaults(func=cmd_diff)

    # ls
    p = sub.add_parser("ls", help="List files/directories (file tree).")
    _add_root_arg(p)
    p.add_argument("path", nargs="?", default=None, help="Directory path (default: root).")
    p.add_argument("--depth", type=int, default=None, help="Max tree depth (0-10).")
    p.set_defaults(func=cmd_ls)

    # file
    p = sub.add_parser("file", help="Read a file's content.")
    _add_root_arg(p)
    p.add_argument("path", help="File path relative to repo root.")
    p.set_defaults(func=cmd_file)

    # add-comment
    p = sub.add_parser("add-comment", help="Add a review comment.")
    _add_root_arg(p)
    p.add_argument("path", help="File path relative to repo root.")
    p.add_argument("line_start", type=int, help="First line (1-based).")
    p.add_argument("line_end", type=int, help="Last line (1-based, inclusive).")
    p.add_argument("text", nargs="?", default="", help="Comment text.")
    p.add_argument("--highlighted", default=None, help="Verbatim source text being commented on.")
    p.set_defaults(func=cmd_add_comment)

    # list-comments
    p = sub.add_parser("list-comments", aliases=["comments"], help="List all review comments.")
    _add_root_arg(p)
    p.set_defaults(func=cmd_list_comments)

    # update-comment
    p = sub.add_parser("update-comment", help="Update a comment's text.")
    _add_root_arg(p)
    p.add_argument("id", help="Comment UUID.")
    p.add_argument("text", help="New comment text.")
    p.set_defaults(func=cmd_update_comment)

    # delete-comment
    p = sub.add_parser("delete-comment", help="Delete a comment.")
    _add_root_arg(p)
    p.add_argument("id", help="Comment UUID.")
    p.set_defaults(func=cmd_delete_comment)

    # clear
    p = sub.add_parser("clear", help="Delete all comments.")
    _add_root_arg(p)
    p.set_defaults(func=cmd_clear)

    # delete-outdated
    p = sub.add_parser("delete-outdated", help="Delete comments marked outdated.")
    _add_root_arg(p)
    p.set_defaults(func=cmd_delete_outdated)

    # recompute-stale
    p = sub.add_parser("recompute-stale", help="Recompute outdated flags for all comments.")
    _add_root_arg(p)
    p.set_defaults(func=cmd_recompute_stale)

    # save
    p = sub.add_parser("save", help="Save comments to JSON + Markdown files.")
    _add_root_arg(p)
    p.add_argument("--stem", default=None, help="Output filename stem (no extension).")
    p.add_argument("--dir", default=None, help="Output directory.")
    p.set_defaults(func=cmd_save)

    # load
    p = sub.add_parser("load", help="Load comments from a saved review stem.")
    _add_root_arg(p)
    p.add_argument("stem", help="Review file stem (e.g. 'review_comments').")
    p.set_defaults(func=cmd_load)

    # list-reviews
    p = sub.add_parser("list-reviews", aliases=["reviews"], help="List saved review file stems.")
    _add_root_arg(p)
    p.set_defaults(func=cmd_list_reviews)

    # open
    p = sub.add_parser("open", help="Open a file in the browser UI.")
    _add_root_arg(p)
    p.add_argument("path", help="File path relative to repo root.")
    p.add_argument("--mode", choices=["view", "diff"], default="view")
    p.set_defaults(func=cmd_open)

    # highlight
    p = sub.add_parser("highlight", help="Highlight a line range in the browser UI.")
    _add_root_arg(p)
    p.add_argument("path", help="File path relative to repo root.")
    p.add_argument("line_start", type=int, help="First line (1-based).")
    p.add_argument("line_end", type=int, help="Last line (1-based, inclusive).")
    p.set_defaults(func=cmd_highlight)

    # jump
    p = sub.add_parser("jump", help="Jump to a comment's location in the browser UI.")
    _add_root_arg(p)
    p.add_argument("comment_id", help="Comment UUID.")
    p.set_defaults(func=cmd_jump)

    # init-session
    p = sub.add_parser("init-session", help="Register the CLI client with the server.")
    _add_root_arg(p)
    p.add_argument("--agent", default=None, help="Agent name (default: batch-review-cli).")
    p.add_argument("--model", default=None, help="Model name.")
    p.add_argument("--version", default=None, help="Client version.")
    p.set_defaults(func=cmd_init_session)

    return parser


def run_cli_verb() -> None:
    """Entry point called by main.py when the first argv is a known CLI verb."""
    # Resolve aliases (e.g. ``comments`` → ``list-comments``) before parsing.
    argv = list(sys.argv[1:])
    if argv and argv[0] in _VERB_ALIASES:
        argv[0] = _VERB_ALIASES[argv[0]]

    parser = build_parser()
    args = parser.parse_args(argv)
    args.func(args)
