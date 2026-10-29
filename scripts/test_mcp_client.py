"""Connect to batch-review via MCP stdio and print tool names (smoke test)."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path
from unittest.mock import patch

from mcp import ClientSession, StdioServerParameters
from mcp.client import Client
from mcp.client.stdio import stdio_client

from backend.models import Comment
from backend.state import AppState
from backend.user_identity import default_userid, normalize_userid

ROOT = Path(__file__).resolve().parents[1]


def check_in_memory_session_isolation() -> None:
    """Verify changing one registered session cannot change another session's userid."""
    print("Checking in-memory MCP session isolation…", flush=True)
    state = AppState(ROOT)
    state.register_mcp_session(
        "session-a",
        "smoke-a",
        userid="reviewer-a",
        context_session_id="context-a",
    )
    state.register_mcp_session("session-b", "smoke-b", userid="reviewer-b")
    original_a = state.get_mcp_session("session-a")
    original_latest = state.get_mcp_session("session-b")
    try:
        state.register_mcp_session("session-a", "attacker", userid="spoofed")
    except ValueError as exc:
        assert "already registered" in str(exc)
    else:
        raise AssertionError("duplicate session capability must be rejected")
    assert state.get_mcp_session("session-a") == original_a
    assert state.mcp_session_info == original_latest
    assert len(state.mcp_sessions) == 2
    public_latest = state.get_public_mcp_session_info()
    public_sessions = state.list_public_mcp_sessions()
    public_keys = {"coding_agent", "model_name", "client_version"}
    assert public_latest is not None and set(public_latest) == public_keys
    assert public_sessions and all(set(item) == public_keys for item in public_sessions)
    state.set_mcp_session_userid("session-a", "reviewer-a-updated")
    session_a = state.get_mcp_session("session-a")
    session_b = state.get_mcp_session("session-b")
    assert session_a is not None and session_a["userid"] == "reviewer-a-updated"
    assert session_b is not None and session_b["userid"] == "reviewer-b"
    context_session = state.get_mcp_session_for_context("context-a")
    assert context_session is not None and context_session["session_id"] == "session-a"
    attributed = state.add_comment("README.md", 1, 1, userid=session_b["userid"])
    assert attributed.userid == "reviewer-b"
    legacy = Comment(
        file_path="README.md",
        line_start=1,
        line_end=1,
        reference="@README.md:L1-1",
    )
    assert legacy.userid == state.default_userid

    capacity_state = AppState(ROOT)
    capacity_state.register_mcp_session("active", "capacity-smoke")
    for index in range(255):
        capacity_state.register_mcp_session(f"filler-{index}", "capacity-smoke")
    try:
        capacity_state.register_mcp_session("overflow", "capacity-smoke")
    except ValueError as exc:
        assert "capacity reached" in str(exc)
    else:
        raise AssertionError("257th session registration must be rejected")
    assert capacity_state.get_mcp_session("active") is not None

    print(
        "OK: concurrent identities, private capabilities, and legacy defaults are isolated",
        flush=True,
    )


def check_userid_validation() -> None:
    """Reject spoofing controls while preserving printable international identities."""
    print("Checking userid validation boundaries…", flush=True)
    for value in (
        "bad\nname",
        "\nAlice",
        "Alice\u0085",
        "Alice\u2028",
        "bad\u2029name",
        "bad\u202ename",
        "\u2029",
        "\u00a0Alice",
        "bad\ud800name",
    ):
        try:
            normalize_userid(value)
        except ValueError:
            pass
        else:
            raise AssertionError(f"hostile userid was accepted: {value!r}")
    for value in ("José", "李雷", "أحمد", "x" * 256):
        assert normalize_userid(value) == value
    try:
        normalize_userid("x" * 257)
    except ValueError:
        pass
    else:
        raise AssertionError("userid longer than 256 characters was accepted")
    with patch("backend.user_identity.getpass.getuser", return_value="\nInjected"):
        fallback_userid = default_userid()
    assert fallback_userid != "Injected"
    assert normalize_userid(fallback_userid) == fallback_userid
    print("OK: userid controls and length boundaries are enforced", flush=True)


def tool_payload(result) -> dict:
    """Unwrap FastMCP's structured ``result`` envelope."""
    data = result.structured_content or {}
    return data.get("result", data)


async def check_modern_http(mcp_http_url: str) -> None:
    """Exercise two simultaneous 2026-07-28 stateless clients against one server."""
    url = mcp_http_url.rstrip("/") + "/"
    print("Connecting two modern stateless HTTP clients…", flush=True)
    async with Client(url, mode="2026-07-28") as client_a:
        async with Client(url, mode="2026-07-28") as client_b:
            init_a = tool_payload(await client_a.call_tool(
                "init_batch_review_session",
                {"coding_agent": "modern-smoke-a", "userid": "reviewer-a"},
            ))
            init_b = tool_payload(await client_b.call_tool(
                "init_batch_review_session",
                {"coding_agent": "modern-smoke-b", "userid": "reviewer-b"},
            ))
            session_a = init_a["session_id"]
            session_b = init_b["session_id"]
            assert session_a != session_b

            config = tool_payload(await client_a.call_tool("get_config", {}))
            public_keys = {"coding_agent", "model_name", "client_version"}
            public_sessions = config["mcp_sessions"]
            assert public_sessions and all(
                set(item) == public_keys for item in public_sessions
            )
            assert set(config["mcp_session"]) == public_keys

            changed_a = tool_payload(await client_a.call_tool(
                "set_current_userid",
                {"userid": "reviewer-a-updated", "session_id": session_a},
            ))
            assert changed_a["userid"] == "reviewer-a-updated"
            assert "session_id" not in changed_a
            current_a = tool_payload(await client_a.call_tool(
                "get_current_userid", {"session_id": session_a},
            ))
            current_b = tool_payload(await client_b.call_tool(
                "get_current_userid", {"session_id": session_b},
            ))
            assert current_a["userid"] == "reviewer-a-updated"
            assert current_b["userid"] == "reviewer-b"
            assert "session_id" not in current_a and "session_id" not in current_b

            comment_a = tool_payload(await client_a.call_tool(
                "add_comment",
                {
                    "file_path": "README.md",
                    "line_start": 1,
                    "line_end": 1,
                    "text": "Modern MCP userid smoke test A",
                    "session_id": session_a,
                },
            ))
            comment_b = tool_payload(await client_b.call_tool(
                "add_comment",
                {
                    "file_path": "README.md",
                    "line_start": 1,
                    "line_end": 1,
                    "text": "Modern MCP userid smoke test B",
                    "session_id": session_b,
                },
            ))
            assert comment_a["userid"] == "reviewer-a-updated"
            assert comment_b["userid"] == "reviewer-b"
            await client_a.call_tool("get_git_changes", {"session_id": session_a})
            await client_b.call_tool("get_git_changes", {"session_id": session_b})
    print("OK: modern stateless sessions are isolated and concurrently usable", flush=True)


async def main() -> None:
    check_in_memory_session_isolation()
    check_userid_validation()
    print("Connecting MCP stdio client…", flush=True)
    params = StdioServerParameters(
        command="uv",
        args=[
            "run",
            "--no-sync",
            "batch-review",
            "--mcp",
            "--root",
            str(ROOT),
            "--skip-build",
            "--no-browser",
        ],
        cwd=str(ROOT),
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            res = await session.list_tools()
            names = sorted(t.name for t in res.tools)
            print(f"OK: {len(names)} tools", flush=True)
            for n in names:
                print(f"  - {n}", flush=True)

            gated = await session.call_tool("get_git_changes", {})
            if not gated.is_error:
                print("FAILED: get_git_changes should be rejected before init", flush=True)
                raise SystemExit(1)
            print("OK: gated tool rejected before init", flush=True)

            init_res = await session.call_tool(
                "init_batch_review_session",
                {"coding_agent": "MCP stdio smoke test", "model_name": ""},
            )
            if init_res.is_error:
                print(f"FAILED: init_batch_review_session: {init_res}", flush=True)
                raise SystemExit(1)
            print("OK: init_batch_review_session", flush=True)
            init_payload = init_res.structured_content or {}
            init_payload = init_payload.get("result", init_payload)
            application_session_id = init_payload.get("session_id")
            if not application_session_id:
                print(f"FAILED: init did not return session_id: {init_payload}", flush=True)
                raise SystemExit(1)

            current_user = await session.call_tool("get_current_userid", {})
            if current_user.is_error:
                print(f"FAILED: get_current_userid: {current_user}", flush=True)
                raise SystemExit(1)
            print("OK: get_current_userid", flush=True)

            stateless_user = await session.call_tool(
                "get_current_userid",
                {"session_id": application_session_id},
            )
            if stateless_user.is_error:
                print(f"FAILED: explicit stateless session_id: {stateless_user}", flush=True)
                raise SystemExit(1)
            print("OK: explicit stateless session_id", flush=True)

            changed_user = await session.call_tool(
                "set_current_userid",
                {"userid": "mcp-smoke-reviewer", "session_id": application_session_id},
            )
            if changed_user.is_error:
                print(f"FAILED: set_current_userid: {changed_user}", flush=True)
                raise SystemExit(1)
            print("OK: set_current_userid", flush=True)

            comment_result = await session.call_tool(
                "add_comment",
                {
                    "file_path": "README.md",
                    "line_start": 1,
                    "line_end": 1,
                    "text": "MCP userid smoke test",
                    "highlighted_text": "# Batch Review MCP",
                    "session_id": application_session_id,
                },
            )
            if comment_result.is_error:
                print(f"FAILED: add_comment with userid: {comment_result}", flush=True)
                raise SystemExit(1)
            structured = comment_result.structured_content or {}
            comment_payload = structured.get("result", structured)
            if comment_payload.get("userid") != "mcp-smoke-reviewer":
                print(f"FAILED: comment userid mismatch: {comment_payload}", flush=True)
                raise SystemExit(1)
            print("OK: add_comment uses session userid", flush=True)

            after = await session.call_tool(
                "get_git_changes",
                {"session_id": application_session_id},
            )
            if after.is_error:
                print(f"FAILED: get_git_changes after init: {after}", flush=True)
                raise SystemExit(1)
            print("OK: get_git_changes after init", flush=True)
            rlist = await session.list_resources()
            print(f"OK: {len(rlist.resources)} resources", flush=True)
            for r in rlist.resources:
                print(f"  - {r.uri}", flush=True)
            if rlist.resources:
                target = next(
                    (r.uri for r in rlist.resources if str(r.uri).endswith("server/urls")),
                    rlist.resources[0].uri,
                )
                body = await session.read_resource(target)
                for part in body.contents:
                    if hasattr(part, "text") and part.text:
                        preview = part.text.strip().splitlines()[0][:120]
                        print(f"read_resource preview: {preview!r}", flush=True)
                        break

            urls_result = await session.call_tool("get_review_web_url", {})
            urls_payload = tool_payload(urls_result)
            mcp_http_url = urls_payload.get("mcp_http")
            if not mcp_http_url:
                print(f"FAILED: MCP HTTP URL unavailable: {urls_payload}", flush=True)
                raise SystemExit(1)
            await check_modern_http(mcp_http_url)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr, flush=True)
        raise
