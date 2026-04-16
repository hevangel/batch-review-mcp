"""Verify server.json MCPB metadata matches this tag and the built .mcpb on disk.

Intended for GitHub Actions on tag builds (Linux). Requires env GITHUB_REF_NAME (e.g. v0.1.0).
Exits non-zero if the registry would reject the release (wrong URL, version skew, or SHA mismatch).
"""
from __future__ import annotations

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


def main() -> None:
    ref_name = os.environ.get("GITHUB_REF_NAME", "").strip()
    if not ref_name.startswith("v"):
        print(
            "verify: GITHUB_REF_NAME must be a version tag like v0.1.0 (got %r)" % (ref_name,),
            file=sys.stderr,
        )
        sys.exit(1)

    tag_version = ref_name[1:]
    repo_root = Path(__file__).resolve().parents[1]
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
            "  Fix: run the Actions workflow 'MCP registry preflight (Linux MCPB hash)', "
            "copy the printed SHA into server.json, commit, then move your release tag "
            "to that commit and re-run the Release workflow.",
            file=sys.stderr,
        )
        sys.exit(1)

    print("verify: OK — server.json matches tag %s and dist MCPB (%s)" % (ref_name, mcpb_path.name))


if __name__ == "__main__":
    main()
