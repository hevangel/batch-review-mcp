"""Update server.json fileSha256 from the built Linux MCP bundle on disk.

Intended for the Release workflow after ``scripts/build_mcpb.py`` writes the final
``dist/batch-review-mcp-<version>.mcpb``. This removes the need to manually copy a
Linux SHA from a separate preflight run before tagging.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from pathlib import Path


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=None,
        help="Repository root containing server.json and dist/.",
    )
    parser.add_argument(
        "--tag",
        default="",
        help="Version tag to sync (defaults to env GITHUB_REF_NAME).",
    )
    return parser.parse_args()


def main() -> None:
    args = _parse_args()
    ref_name = (args.tag or os.environ.get("GITHUB_REF_NAME", "")).strip()
    if not ref_name.startswith("v"):
        print(
            "Progress: expected a version tag like v0.1.0 (got %r)" % (ref_name,),
            file=sys.stderr,
        )
        sys.exit(1)

    tag_version = ref_name[1:]
    repo_root = (args.repo_root or Path(__file__).resolve().parents[1]).resolve()
    server_path = repo_root / "server.json"
    mcpb_path = repo_root / "dist" / f"batch-review-mcp-{tag_version}.mcpb"

    print("Progress: syncing server.json MCPB SHA for", ref_name)
    if not server_path.is_file():
        print("Progress: missing %s" % server_path, file=sys.stderr)
        sys.exit(1)
    if not mcpb_path.is_file():
        print("Progress: missing %s (run scripts/build_mcpb.py first)" % mcpb_path, file=sys.stderr)
        sys.exit(1)

    data = json.loads(server_path.read_text(encoding="utf-8"))
    if data.get("version") != tag_version:
        print(
            "Progress: server.json version %r must match tag version %r"
            % (data.get("version"), tag_version),
            file=sys.stderr,
        )
        sys.exit(1)

    mcpb_pkgs = [pkg for pkg in data.get("packages", []) if pkg.get("registryType") == "mcpb"]
    if len(mcpb_pkgs) != 1:
        print("Progress: expected exactly one mcpb package in server.json", file=sys.stderr)
        sys.exit(1)

    digest = hashlib.sha256(mcpb_path.read_bytes()).hexdigest()
    pkg = mcpb_pkgs[0]
    old_digest = pkg.get("fileSha256", "")
    pkg["fileSha256"] = digest

    server_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    if old_digest == digest:
        print("Progress: server.json already had the correct SHA-256")
    else:
        print("Progress: updated server.json fileSha256")
        print("Progress: old SHA-256", old_digest)
        print("Progress: new SHA-256", digest)


if __name__ == "__main__":
    main()
