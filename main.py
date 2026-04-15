"""Entry point for the Batch Review tool.

Usage (standalone — opens browser):
    uv run python main.py [--root /path/to/repo] [--port 8000] [--host 0.0.0.0]

Usage (MCP stdio — for Claude Desktop / Cursor):
    uv run python main.py --mcp [--root /path/to/repo] [--port 8000]

The --mcp flag starts the HTTP server in a background thread and then runs the
FastMCP stdio transport in the main thread so that MCP clients can connect.
"""
from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("batch_review")

_HERE = Path(__file__).parent
_FRONTEND_DIR = _HERE / "frontend"
_FRONTEND_DIST = _FRONTEND_DIR / "dist"


# ---------------------------------------------------------------------------
# Frontend build helpers
# ---------------------------------------------------------------------------

def _npm_cmd() -> list[str]:
    """Return the npm command appropriate for the current OS."""
    if sys.platform == "win32":
        return ["npm.cmd"]
    return ["npm"]


def ensure_frontend_built() -> None:
    """Build the React frontend if frontend/dist/index.html is missing."""
    index_html = _FRONTEND_DIST / "index.html"
    if index_html.exists():
        logger.info("Frontend dist already exists — skipping build.")
        return

    if not _FRONTEND_DIR.exists():
        logger.error("frontend/ directory not found at %s", _FRONTEND_DIR)
        sys.exit(1)

    npm = _npm_cmd()

    # Install dependencies
    node_modules = _FRONTEND_DIR / "node_modules"
    if not node_modules.exists():
        logger.info("Installing frontend dependencies (npm ci)…")
        result = subprocess.run(
            npm + ["ci"],
            cwd=str(_FRONTEND_DIR),
            check=False,
        )
        if result.returncode != 0:
            logger.error("npm ci failed (exit %d)", result.returncode)
            sys.exit(1)
        logger.info("Frontend dependencies installed.")
    else:
        logger.info("node_modules found — skipping npm ci.")

    logger.info("Building frontend (npm run build)…")
    result = subprocess.run(
        npm + ["run", "build"],
        cwd=str(_FRONTEND_DIR),
        check=False,
    )
    if result.returncode != 0:
        logger.error("npm run build failed (exit %d)", result.returncode)
        sys.exit(1)
    logger.info("Frontend build complete.")


# ---------------------------------------------------------------------------
# Launch helpers
# ---------------------------------------------------------------------------

def _start_uvicorn_thread(app, host: str, port: int) -> None:
    """Start uvicorn in a daemon background thread (used for MCP stdio mode)."""

    def _run():
        uvicorn.run(app, host=host, port=port, log_level="warning")

    t = threading.Thread(target=_run, daemon=True)
    t.start()
    logger.info("HTTP server started in background thread on %s:%d", host, port)
    # Give the server a moment to bind before the MCP stdio loop starts
    time.sleep(1.5)


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

import socket


def _find_free_port(preferred: int, host: str = "127.0.0.1") -> int:
    """Return *preferred* if it's free, otherwise the next free port ≥ preferred."""
    for port in range(preferred, preferred + 1000):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, port))
                return port
            except OSError:
                continue
    raise RuntimeError("No free port found in range %d–%d" % (preferred, preferred + 1000))


def cli_main() -> None:
    parser = argparse.ArgumentParser(
        description="Batch Review — collaborative markdown/code review tool",
    )
    parser.add_argument(
        "--root",
        default=os.getcwd(),
        help="Path to the git repository to review (default: current directory)",
    )
    parser.add_argument(
        "--host",
        default="127.0.0.1",
        help="Host to bind the HTTP server (default: 127.0.0.1)",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=9000,
        help="Preferred port (auto-selects next free port if busy, default: 9000)",
    )
    parser.add_argument(
        "--output",
        default="review_comments",
        metavar="NAME",
        help="Base filename for saved review files, without extension (default: review_comments)",
    )
    parser.add_argument(
        "--output-dir",
        default=None,
        metavar="DIR",
        help="Directory to write output files (default: repo root)",
    )
    parser.add_argument(
        "--mcp",
        action="store_true",
        help="Run in MCP stdio mode (for Claude Desktop / Cursor integration)",
    )
    parser.add_argument(
        "--dev",
        action="store_true",
        help="Enable hot-reload for the backend (uvicorn --reload). "
             "Combine with 'npm run dev' in frontend/ for full HMR.",
    )
    parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not open the browser automatically (standalone mode only)",
    )
    parser.add_argument(
        "--skip-build",
        action="store_true",
        help="Skip the frontend build step even if dist is missing",
    )
    args = parser.parse_args()

    repo_root = Path(args.root).resolve()
    if not repo_root.exists():
        logger.error("Repository root does not exist: %s", repo_root)
        sys.exit(1)

    logger.info("Repository root: %s", repo_root)

    output_dir = Path(args.output_dir).resolve() if args.output_dir else repo_root / "logs" / "batch_review"

    # Build frontend unless asked to skip
    if not args.skip_build:
        ensure_frontend_built()
    else:
        logger.info("Skipping frontend build (--skip-build).")

    # Import app factory (after state / deps are ready)
    from backend.app import create_app

    logger.info("Creating application…")
    app, mcp_instance = create_app(
        repo_root,
        output_stem=args.output,
        output_dir=output_dir,
    )

    # Auto-select a free port
    port = _find_free_port(args.port, args.host)
    if port != args.port:
        logger.info("Port %d busy — using %d instead", args.port, port)

    url = f"http://{args.host}:{port}"

    if args.mcp:
        # ---- MCP stdio mode ------------------------------------------------
        logger.info("Starting HTTP server in background thread…")
        _start_uvicorn_thread(app, args.host, port)
        logger.info("MCP endpoint available at %s/mcp", url)
        logger.info("Starting FastMCP stdio transport…")
        mcp_instance.run(transport="stdio")
    elif args.dev:
        # ---- Dev mode: uvicorn --reload ------------------------------------
        # Pass config to the thin dev-entry module via env vars so uvicorn
        # can re-import it cleanly on each reload.
        os.environ["BATCH_REVIEW_ROOT"] = str(repo_root)
        os.environ["BATCH_REVIEW_STEM"] = args.output
        os.environ["BATCH_REVIEW_OUTPUT_DIR"] = str(output_dir)
        logger.info("Dev mode — backend hot-reload enabled at %s", url)
        logger.info(
            "For frontend HMR run in another terminal:\n"
            "  cd frontend && VITE_BACKEND_PORT=%d npm run dev", port
        )
        if not args.no_browser:
            threading.Thread(
                target=lambda: (time.sleep(1.2), webbrowser.open(url)), daemon=True
            ).start()
        uvicorn.run(
            "backend._dev_entry:app",
            host=args.host,
            port=port,
            reload=True,
            reload_dirs=[str(_HERE / "backend")],
            log_level="info",
        )
    else:
        # ---- Standalone mode -----------------------------------------------
        def _open_browser():
            time.sleep(1.2)
            if not args.no_browser:
                logger.info("Opening browser at %s", url)
                webbrowser.open(url)

        browser_thread = threading.Thread(target=_open_browser, daemon=True)
        browser_thread.start()

        logger.info("Starting Batch Review at %s", url)
        uvicorn.run(app, host=args.host, port=port, log_level="info")


if __name__ == "__main__":
    cli_main()
