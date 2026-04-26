"""Verify server.json MCPB metadata matches the release tag and built .mcpb on disk.

Intended for GitHub Actions on tag builds (Linux). By default the script reads the tag
from env ``GITHUB_REF_NAME`` (e.g. ``v0.1.0``), but manual recovery workflows may pass
``--tag`` explicitly. Exits non-zero if the registry would reject the release (wrong URL,
version skew, or SHA mismatch).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from pathlib import Path


def _read_pyproject_version(pyproject: Path) -> str:
    text = pyproject.read_text(encoding="utf-8")
    match = re.search(r'(?m)^version\s*=\s*"([^"]+)"\s*$', text)
    if not match:
        print("verify: could not read version from pyproject.toml", file=sys.stderr)
        sys.exit(1)
    return match.group(1)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=None,
        help="Repository root containing pyproject.toml, server.json, and dist/.",
    )
    parser.add_argument(
        "--tag",
        default="",
        help="Version tag to verify (defaults to env GITHUB_REF_NAME).",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    ref_name = (args.tag or os.environ.get("GITHUB_REF_NAME", "")).strip()
    if not ref_name.startswith("v"):
        print(
            "verify: GITHUB_REF_NAME must be a version tag like v0.1.0 (got %r)" % (ref_name,),
            file=sys.stderr,
        )
        sys.exit(1)

    tag_version = ref_name[1:]
    repo_root = (args.repo_root or Path(__file__).resolve().parents[1]).resolve()
    py_ver = _read_pyproject_version(repo_root / "pyproject.toml")
    if py_ver != tag_version:
        print(
            "verify: pyproject.toml version %r must match tag %r (version part %r)"
            % (py_ver, ref_name, tag_version),
            file=sys.stderr,
        )
        sys.exit(1)

    server_path = repo_root / "server.json"
    data = json.loads(server_path.read_text(encoding="utf-8"))
    if data.get("version") != tag_version:
        print(
            "verify: server.json top-level version %r must match tag version %r"
            % (data.get("version"), tag_version),
            file=sys.stderr,
        )
        sys.exit(1)

    mcpb_pkgs = [p for p in data.get("packages", []) if p.get("registryType") == "mcpb"]
    if len(mcpb_pkgs) != 1:
        print("verify: expected exactly one mcpb package in server.json", file=sys.stderr)
        sys.exit(1)
    pkg = mcpb_pkgs[0]

    slug = os.environ.get("GITHUB_REPOSITORY", "hevangel/batch-review-mcp")
    expected_identifier = (
        f"https://github.com/{slug}/releases/download/{ref_name}/"
        f"batch-review-mcp-{tag_version}.mcpb"
    )
    if pkg.get("identifier") != expected_identifier:
        print("verify: server.json packages[].identifier mismatch.", file=sys.stderr)
        print("  expected: %s" % expected_identifier, file=sys.stderr)
        print("  actual:   %s" % pkg.get("identifier"), file=sys.stderr)
        sys.exit(1)

    mcpb_path = repo_root / "dist" / f"batch-review-mcp-{tag_version}.mcpb"
    if not mcpb_path.is_file():
        print("verify: missing %s (run scripts/build_mcpb.py first)" % mcpb_path, file=sys.stderr)
        sys.exit(1)

    actual_sha = hashlib.sha256(mcpb_path.read_bytes()).hexdigest()
    expected_sha = pkg.get("fileSha256", "")
    if actual_sha != expected_sha:
        print("verify: fileSha256 mismatch — MCP registry and clients require an exact match.", file=sys.stderr)
        print("  CI-built .mcpb SHA-256: %s" % actual_sha, file=sys.stderr)
        print("  server.json fileSha256: %s" % expected_sha, file=sys.stderr)
        print(
            "  Fix: run scripts/update_server_json_mcpb_sha.py for local/manual checks, "
            "or let the Release workflow recompute the Linux SHA and patch server.json "
            "in its workspace before publish.",
            file=sys.stderr,
        )
        sys.exit(1)

    print("verify: OK — server.json matches tag %s and dist MCPB (%s)" % (ref_name, mcpb_path.name))


if __name__ == "__main__":
    main()
