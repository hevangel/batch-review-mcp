"""MCP protocol-version compatibility tracking.

This module documents which Model Context Protocol specification revisions
this server speaks, and is the single anchor point for the protocol-version
information surfaced via MCP tools (``get_config``) and the UI.

Protocol eras
-------------

The MCP spec defines two eras:

* **Legacy** — revisions ``2025-11-25`` and earlier. These use a
  connection-scoped ``initialize`` handshake and (for the streamable HTTP
  transport) ``Mcp-Session-Id`` session management. This is the era every
  currently-released MCP host (Cursor, Claude Desktop, VS Code, Codex,
  Gemini CLI) speaks today.

* **Modern** — revision ``2026-07-28`` and later. This is a stateless,
  per-request-metadata redesign: there is no ``initialize`` handshake, no
  session IDs, and every request carries its protocol version and client
  capabilities in ``_meta.io.modelcontextprotocol/*`` fields. The HTTP
  transport mirrors those into ``MCP-Protocol-Version`` / ``Mcp-Method`` /
  ``Mcp-Name`` headers, and servers MUST implement ``server/discover``.

Supporting the modern era requires the ``mcp`` Python SDK at version
``>=2.0.0`` (released 2026-07-28). However, this server is built on
``fastmcp``, whose latest stable PyPI release (3.x) pins ``mcp<2.0``.
Native dual-era support (one deployment serving both modern and legacy
clients, negotiated per connection) is promised by ``fastmcp`` 4.x, which
is not yet published to PyPI. When that release lands, bumping the pin and
removing the ``2026-07-28`` entry from :data:`PENDING_PROTOCOL_VERSIONS`
below is the intended migration path — no other code in this repo needs to
change, because all protocol-level negotiation is delegated to the
``fastmcp`` / ``mcp`` libraries (see ``backend/app.py`` and
``backend/mcp_tools.py``).

Until then, this server speaks the legacy era only, which is fully backward
compatible with every existing MCP client.
"""

from __future__ import annotations

from mcp import types as _mcp_types

#: The highest protocol version the installed ``mcp`` SDK advertises.
#: Read live from the library so it stays correct after a dependency bump.
#: As of ``mcp==1.29.0`` this is ``"2025-11-25"`` (the latest legacy-era
#: revision). Under ``mcp>=2.0.0`` it becomes ``"2026-07-28"``.
ACTIVE_PROTOCOL_VERSION: str = _mcp_types.LATEST_PROTOCOL_VERSION

#: Protocol revisions this server can actually serve right now, using the
#: installed ``fastmcp`` / ``mcp`` libraries. All are legacy-era.
SUPPORTED_PROTOCOL_VERSIONS: tuple[str, ...] = (ACTIVE_PROTOCOL_VERSION,)

#: Modern-era revisions this server *will* serve once ``fastmcp`` 4.x is
#: stable on PyPI and the ``mcp`` pin moves to ``>=2.0.0``. Tracked here so
#: the eventual upgrade is a one-line change.
PENDING_PROTOCOL_VERSIONS: tuple[str, ...] = ("2026-07-28",)


def protocol_info() -> dict:
    """Return a JSON-serialisable snapshot of the server's protocol-era status.

    Surfaced through the ``get_config`` MCP tool and the REST ``/api/config``
    endpoint so agents and the browser UI can see which era is live.
    """
    return {
        "active_protocol_version": ACTIVE_PROTOCOL_VERSION,
        "supported_protocol_versions": list(SUPPORTED_PROTOCOL_VERSIONS),
        "pending_protocol_versions": list(PENDING_PROTOCOL_VERSIONS),
        "modern_era_available": ACTIVE_PROTOCOL_VERSION in PENDING_PROTOCOL_VERSIONS,
    }
