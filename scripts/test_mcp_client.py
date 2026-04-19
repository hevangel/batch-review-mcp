"""Connect to batch-review via MCP stdio and print tool names (smoke test)."""
from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client

ROOT = Path(__file__).resolve().parents[1]


async def main() -> None:
    print("Connecting MCP stdio client…", flush=True)
    params = StdioServerParameters(
        command="uv",
        args=[
            "run",
            "batch-review",
            "--mcp",
            "--root",
            str(ROOT),
            "--skip-build",
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
            if not gated.isError:
                print("FAILED: get_git_changes should be rejected before init", flush=True)
                raise SystemExit(1)
            print("OK: gated tool rejected before init", flush=True)

            init_res = await session.call_tool(
                "init_batch_review_session",
                {"coding_agent": "MCP stdio smoke test", "model_name": ""},
            )
            if init_res.isError:
                print(f"FAILED: init_batch_review_session: {init_res}", flush=True)
                raise SystemExit(1)
            print("OK: init_batch_review_session", flush=True)

            after = await session.call_tool("get_git_changes", {})
            if after.isError:
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


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(f"FAILED: {exc}", file=sys.stderr, flush=True)
        raise
