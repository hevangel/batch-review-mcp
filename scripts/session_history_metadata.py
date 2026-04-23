"""Extract Cursor Agent CLI metadata for session_history files.

Reads a saved ``agent --print --output-format stream-json`` log (or a terminal
capture containing those JSON lines) and combines it with ``agent about
--format json`` to produce a session-history-ready metadata block.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


@dataclass
class UsageTotals:
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0

    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens


@dataclass
class StreamMetadata:
    model: str = ""
    session_id: str = ""
    request_id: str = ""
    usage: UsageTotals | None = None


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--stream-json",
        type=Path,
        default=None,
        help=(
            "Path to a saved `agent --print --output-format stream-json` log, or "
            "a terminal file containing those JSON lines."
        ),
    )
    parser.add_argument(
        "--about-json",
        type=Path,
        default=None,
        help="Optional path to a saved `agent about --format json` output.",
    )
    parser.add_argument(
        "--format",
        choices=("markdown", "json"),
        default="markdown",
        help="Output format (default: markdown).",
    )
    parser.add_argument(
        "--harness",
        default="Cursor CLI coding agent",
        help="Harness label to emit in the markdown output.",
    )
    parser.add_argument(
        "--require-usage",
        action="store_true",
        help="Exit non-zero if no exact usage block is found in the stream-json input.",
    )
    return parser.parse_args()


def _read_about_payload(path: Path | None) -> dict[str, Any]:
    if path is not None:
        print(f"Progress: reading agent about JSON from {path}", file=sys.stderr)
        return json.loads(path.read_text(encoding="utf-8"))

    agent_cmd = shutil.which("agent") or shutil.which("agent.cmd")
    if not agent_cmd:
        raise FileNotFoundError("Could not locate `agent` on PATH.")

    print("Progress: running `agent about --format json`", file=sys.stderr)
    result = subprocess.run(
        [agent_cmd, "about", "--format", "json"],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    return json.loads(result.stdout)


def _iter_json_lines(path: Path) -> list[dict[str, Any]]:
    print(f"Progress: parsing stream log from {path}", file=sys.stderr)
    items: list[dict[str, Any]] = []
    for raw_line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        line = raw_line.strip()
        if not line or not line.startswith("{"):
            continue
        try:
            data = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(data, dict):
            items.append(data)
    return items


def _read_stream_metadata(path: Path | None) -> StreamMetadata:
    if path is None:
        print("Progress: no stream-json log provided", file=sys.stderr)
        return StreamMetadata()

    items = _iter_json_lines(path)
    metadata = StreamMetadata()
    totals = UsageTotals()
    found_usage = False

    for item in items:
        if item.get("type") == "system" and item.get("subtype") == "init":
            metadata.model = str(item.get("model") or metadata.model)
            metadata.session_id = str(item.get("session_id") or metadata.session_id)
        if item.get("type") == "result":
            metadata.session_id = str(item.get("session_id") or metadata.session_id)
            metadata.request_id = str(item.get("request_id") or metadata.request_id)
            usage = item.get("usage")
            if isinstance(usage, dict):
                totals.input_tokens += int(usage.get("inputTokens") or 0)
                totals.output_tokens += int(usage.get("outputTokens") or 0)
                totals.cache_read_tokens += int(usage.get("cacheReadTokens") or 0)
                totals.cache_write_tokens += int(usage.get("cacheWriteTokens") or 0)
                found_usage = True

    if found_usage:
        metadata.usage = totals
    return metadata


def _infer_provider(model_name: str) -> str:
    lowered = (model_name or "").lower()
    if "gpt" in lowered or "openai" in lowered:
        return "OpenAI"
    if "claude" in lowered or "sonnet" in lowered or "opus" in lowered:
        return "Anthropic"
    if "gemini" in lowered:
        return "Google"
    return "Unknown"


def _fmt_int(value: int) -> str:
    return f"{value:,}"


def _build_payload(
    harness: str,
    about_payload: dict[str, Any],
    stream_metadata: StreamMetadata,
) -> dict[str, Any]:
    model_name = (
        stream_metadata.model
        or str(about_payload.get("model") or "").strip()
    )
    usage = stream_metadata.usage
    return {
        "harness": harness,
        "version": str(about_payload.get("cliVersion") or "").strip(),
        "model": model_name,
        "provider": _infer_provider(model_name),
        "input_tokens": None if usage is None else usage.input_tokens,
        "output_tokens": None if usage is None else usage.output_tokens,
        "total_tokens": None if usage is None else usage.total_tokens,
        "cache_read_tokens": None if usage is None else usage.cache_read_tokens,
        "cache_write_tokens": None if usage is None else usage.cache_write_tokens,
        "session_id": stream_metadata.session_id,
        "request_id": stream_metadata.request_id,
    }


def _print_markdown(payload: dict[str, Any]) -> None:
    input_tokens = payload["input_tokens"]
    output_tokens = payload["output_tokens"]
    total_tokens = payload["total_tokens"]
    cache_read_tokens = payload["cache_read_tokens"]
    cache_write_tokens = payload["cache_write_tokens"]

    if input_tokens is None:
        token_lines = [
            "- Input tokens: unavailable (no exact `usage` block found)",
            "- Output tokens: unavailable (no exact `usage` block found)",
            "- Total tokens: unavailable (no exact `usage` block found)",
        ]
    else:
        token_lines = [
            f"- Input tokens: {_fmt_int(input_tokens)}",
            f"- Output tokens: {_fmt_int(output_tokens)}",
            f"- Total tokens: {_fmt_int(total_tokens)}",
            f"- Cache read tokens: {_fmt_int(cache_read_tokens)}",
            f"- Cache write tokens: {_fmt_int(cache_write_tokens)}",
        ]

    lines = [
        "## Agent harness",
        f"- Harness: {payload['harness']}",
        f"- Version: {payload['version'] or 'unavailable'}",
        "",
        "## Model",
        f"- Model: {payload['model'] or 'unavailable'}",
        f"- Provider: {payload['provider']}",
        "",
        "## Token usage",
        *token_lines,
    ]
    print("\n".join(lines))


def main() -> int:
    args = _parse_args()
    about_payload = _read_about_payload(args.about_json)
    stream_metadata = _read_stream_metadata(args.stream_json)
    payload = _build_payload(args.harness, about_payload, stream_metadata)

    if args.require_usage and payload["input_tokens"] is None:
        print(
            "Error: no exact token usage found. Provide a saved `agent --print "
            "--output-format stream-json` log or terminal capture.",
            file=sys.stderr,
        )
        return 1

    print("Progress: emitting session history metadata", file=sys.stderr)
    if args.format == "json":
        print(json.dumps(payload, indent=2))
    else:
        _print_markdown(payload)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
