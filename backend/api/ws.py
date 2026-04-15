"""WebSocket endpoint — real-time event bus between the UI and MCP tools."""
from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from backend.state import get_state

router = APIRouter()
logger = logging.getLogger(__name__)


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    """Accept a WebSocket connection and hold it open to receive broadcasts."""
    state = get_state()
    await ws.accept()
    state.ws_connections.add(ws)
    logger.info("WebSocket client connected. Total: %d", len(state.ws_connections))
    try:
        while True:
            # Keep the connection alive; clients may send pong/ping messages.
            data = await ws.receive_text()
            logger.debug("WS message received (ignored): %s", data[:200])
    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.warning("WebSocket error: %s", exc)
    finally:
        state.ws_connections.discard(ws)
        logger.info("WebSocket client disconnected. Total: %d", len(state.ws_connections))
