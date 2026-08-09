"""Guard for local-only HTTP requests used by the CLI client and helper scripts.

Both :mod:`backend.cli_client` and the documentation screenshot script
(``scripts/capture_screenshot.py``) discover and call the Batch Review server
over HTTP. The server URL comes from (in priority order) the
``BATCH_REVIEW_WEB_URL`` environment variable, the
``<repo_root>/.batch_review/server.json`` port file, or a localhost port scan.

Because the URL source is not always hard-coded, a malicious value in those
inputs could in principle direct a request to an arbitrary host (an SSRF
vector). This module validates that a candidate server URL points **only** at a
loopback or private-network address before any request is made. The Batch
Review server is a local development tool and never needs to reach the public
internet, so this is a fail-closed guard rather than a configurable policy.
"""

from __future__ import annotations

import http.client
import ipaddress
import socket
import urllib.parse

__all__ = ["LocalUrlError", "assert_local_url", "local_request"]


class LocalUrlError(ValueError):
    """Raised when a server URL does not resolve to a local address."""


def _is_local_ip(ip: str) -> bool:
    """Return True for loopback or private IPv4/IPv6 addresses.

    Link-local addresses (``169.254.0.0/16``, ``fe80::/10``) are deliberately
    rejected even though ``ipaddress`` also marks them private — the
    ``169.254.169.254`` cloud-metadata endpoint is the canonical SSRF target
    and must never be reached by a local dev tool.
    """
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    if addr.is_link_local:
        return False
    return bool(addr.is_loopback or addr.is_private or addr.is_unspecified)


def assert_local_url(url: str) -> str:
    """Validate that *url* resolves to a loopback/private address.

    Parses the URL, rejects non-http(s) schemes, resolves the hostname, and
    confirms every resolved address is local. Returns the URL unchanged on
    success so callers can use it inline: ``url = assert_local_url(url)``.

    Raises :class:`LocalUrlError` (a ``ValueError`` subclass) if the URL is
    malformed, uses an unexpected scheme, or resolves to a non-local address.
    Host resolution failures are treated as non-local and rejected.
    """
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ("http", "https"):
        raise LocalUrlError(
            f"unsupported URL scheme {parsed.scheme!r}; expected http or https"
        )
    host = parsed.hostname
    if not host:
        raise LocalUrlError(f"URL has no host: {url!r}")

    # Literal IP in the URL — check directly, no DNS lookup needed.
    try:
        ipaddress.ip_address(host)
        if not _is_local_ip(host):
            raise LocalUrlError(f"URL host {host!r} is not a local address")
        return url
    except ValueError:
        pass  # Not a literal IP — resolve as a hostname below.

    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise LocalUrlError(f"could not resolve host {host!r}: {exc}") from exc
    if not infos:
        raise LocalUrlError(f"host {host!r} resolved to no addresses")
    for info in infos:
        resolved = info[4][0]
        if not _is_local_ip(resolved):
            raise LocalUrlError(
                f"host {host!r} resolves to {resolved!r}, which is not a local address"
            )
    return url


def local_request(
    url: str,
    *,
    method: str = "GET",
    body: bytes | None = None,
    headers: dict | None = None,
    timeout: float = 30.0,
) -> tuple[int, bytes]:
    """Perform an HTTP request to *url* after verifying it is local.

    This is the single egress point for outbound HTTP from the CLI client and
    helper scripts. It validates the URL with :func:`assert_local_url` and then
    opens the connection via :mod:`http.client`, returning ``(status, body)``.

    Raises :class:`LocalUrlError` if the URL is not local, and
    :class:`OSError`/:class:`http.client.HTTPException` on network errors.
    """
    assert_local_url(url)
    parsed = urllib.parse.urlsplit(url)
    scheme = parsed.scheme
    host = parsed.hostname or ""
    port = parsed.port or (443 if scheme == "https" else 80)
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"

    conn_cls = http.client.HTTPSConnection if scheme == "https" else http.client.HTTPConnection
    conn = conn_cls(host, port, timeout=timeout)
    try:
        conn.request(method, path, body=body, headers=headers or {})
        resp = conn.getresponse()
        raw = resp.read()
        return resp.status, raw
    finally:
        conn.close()
