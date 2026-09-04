"""MCP protocol-version compatibility tracking.

This module is the single anchor for the protocol-version information surfaced
through the ``get_config`` MCP tool and the REST ``/api/config`` endpoint.
Protocol dispatch, transport negotiation, and discovery remain owned by the
installed ``fastmcp`` / ``mcp`` libraries; this module only reports their
capabilities.

FastMCP 4.x is built on the MCP Python SDK 2.x. That stack supports both MCP
protocol eras:

* **Legacy** — revision ``2025-11-25`` and earlier, using the connection-scoped
  ``initialize`` handshake and (for streamable HTTP) ``Mcp-Session-Id``.
* **Modern** — revision ``2026-07-28`` and later, using stateless per-request
  metadata and the ``server/discover`` capability.

The current dependency set (FastMCP 4.0.2 / MCP 2.1.1 in ``uv.lock``) serves
both the legacy and modern eras. Existing MCP hosts can continue using the
legacy handshake while modern clients use the SDK's stateless path. Keeping
these facts here prevents application code from attempting to reimplement
protocol compatibility on top of FastMCP.
"""

from __future__ import annotations

from mcp import types as _mcp_types

_mcp_version = _mcp_types.version

#: The newest protocol revision the installed ``mcp`` SDK advertises.
#: FastMCP 4 / MCP 2 currently reports the modern-era revision.
ACTIVE_PROTOCOL_VERSION: str = _mcp_version.LATEST_PROTOCOL_VERSION

#: The newest revision reachable through the legacy ``initialize`` handshake.
LEGACY_PROTOCOL_VERSION: str = _mcp_version.LATEST_HANDSHAKE_VERSION

#: The newest stateless, modern-era protocol revision.
MODERN_PROTOCOL_VERSION: str = _mcp_version.LATEST_MODERN_VERSION

#: The latest legacy and modern revisions this server can serve. The SDK's
#: complete supported-version registry is used as a guard so this status stays
#: accurate if a future SDK changes its protocol inventory.
SUPPORTED_PROTOCOL_VERSIONS: tuple[str, ...] = tuple(
    version
    for version in (LEGACY_PROTOCOL_VERSION, MODERN_PROTOCOL_VERSION)
    if version in _mcp_version.SUPPORTED_PROTOCOL_VERSIONS
)

#: Modern-era revisions not yet supported by the installed libraries.
#: FastMCP 4 / MCP 2 makes the current modern revision available, so there is
#: no pending revision at present.
PENDING_PROTOCOL_VERSIONS: tuple[str, ...] = ()


def protocol_info() -> dict:
    """Return a JSON-serialisable snapshot of the server's protocol-era status.

    Surfaced through the ``get_config`` MCP tool and the REST ``/api/config``
    endpoint so agents and the browser UI can see which era is live.
    """
    return {
        "active_protocol_version": ACTIVE_PROTOCOL_VERSION,
        "supported_protocol_versions": list(SUPPORTED_PROTOCOL_VERSIONS),
        "pending_protocol_versions": list(PENDING_PROTOCOL_VERSIONS),
        "modern_era_available": MODERN_PROTOCOL_VERSION in SUPPORTED_PROTOCOL_VERSIONS,
    }
