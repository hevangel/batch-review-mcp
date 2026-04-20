"""FastAPI + FastMCP application factory."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastmcp.utilities.lifespan import combine_lifespans

from backend import state as state_module
from backend.api import files, git_ops, reviews, ws
from backend.mcp_tools import mcp

logger = logging.getLogger(__name__)

_FRONTEND_DIST = Path(__file__).parent.parent / "frontend" / "dist"


def create_app(
    repo_root: Path,
    output_stem: str = "review_comments",
    output_dir: Path | None = None,
) -> tuple[FastAPI, object]:
    """Create and return a (FastAPI app, FastMCP instance) pair.

    The FastAPI app has the MCP server mounted at /mcp and serves the
    React frontend from /  (static files from frontend/dist).

    Args:
        repo_root: Absolute path to the repository being reviewed.
        output_stem: Base filename (no extension) for saved review files.
        output_dir: Directory to write output files (defaults to repo_root).

    Returns:
        (app, mcp) tuple — app is the ASGI app to pass to uvicorn,
        mcp is the FastMCP instance for stdio mode.
    """
    # Initialise shared state
    state_module.init_state(repo_root, output_stem=output_stem, output_dir=output_dir)

    # ------------------------------------------------------------------
    # Build the MCP ASGI sub-app
    # ------------------------------------------------------------------
    mcp_asgi = mcp.http_app(path="/")

    # ------------------------------------------------------------------
    # App lifespan: combine our startup log with the MCP session lifespan
    # ------------------------------------------------------------------
    @asynccontextmanager
    async def app_lifespan(application: FastAPI):
        logger.info("Batch Review server starting. Repo root: %s", repo_root)
        yield
        logger.info("Batch Review server shutting down.")

    combined_lifespan = combine_lifespans(app_lifespan, mcp_asgi.lifespan)

    # ------------------------------------------------------------------
    # FastAPI application
    # ------------------------------------------------------------------
    app = FastAPI(
        title="Batch Review",
        description="Collaborative code and markdown review tool.",
        version="0.3.0",
        lifespan=combined_lifespan,
    )

    # CORS — allow any origin for local development convenience.
    # This applies only to the FastAPI routes (not the /mcp mount).
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ------------------------------------------------------------------
    # REST + WebSocket routers
    # ------------------------------------------------------------------
    app.include_router(files.router)
    app.include_router(git_ops.router)
    app.include_router(reviews.router)
    app.include_router(reviews.util_router)
    app.include_router(ws.router)

    # ------------------------------------------------------------------
    # Mount MCP server at /mcp
    # ------------------------------------------------------------------
    app.mount("/mcp", mcp_asgi)

    # ------------------------------------------------------------------
    # Serve React frontend (only if the dist folder exists)
    # ------------------------------------------------------------------
    if _FRONTEND_DIST.is_dir():
        app.mount(
            "/",
            StaticFiles(directory=str(_FRONTEND_DIST), html=True),
            name="frontend",
        )
        logger.info("Serving frontend from %s", _FRONTEND_DIST)
    else:
        logger.warning(
            "Frontend dist not found at %s — run 'npm run build' inside frontend/",
            _FRONTEND_DIST,
        )

    return app, mcp
