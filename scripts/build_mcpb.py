"""Stage a minimal tree and pack batch-review-mcp as an MCP Bundle (.mcpb).

Prints progress to stdout. Requires Node (npx) and a built frontend (frontend/dist/).
Rewrites the packed archive deterministically so repeated builds of the same source tree
produce identical bytes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
import zipfile

# Pin so `npm exec` resolves the same MCPB packer on every machine and in GitHub Actions
# (unpinned `@anthropic-ai/mcpb` produced different .mcpb bytes vs ubuntu-latest).
MCPB_CLI_PACKAGE = "@anthropic-ai/mcpb@2.1.2"


def _npm_cmd() -> str:
    return "npm.cmd" if sys.platform == "win32" else "npm"


def _mcpb_cli(args: list[str], *, cwd: Path) -> None:
    cmd = [_npm_cmd(), "exec", "--yes", f"--package={MCPB_CLI_PACKAGE}", "--", "mcpb", *args]
    subprocess.run(cmd, cwd=str(cwd), check=True)


def _read_project_version(pyproject: Path) -> str:
    text = pyproject.read_text(encoding="utf-8")
    match = re.search(r'(?m)^version\s*=\s*"([^"]+)"\s*$', text)
    if not match:
        print("Progress: could not find [project] version in pyproject.toml", file=sys.stderr)
        sys.exit(1)
    return match.group(1)


def _copy_tree(src: Path, dst: Path) -> None:
    if dst.exists():
        shutil.rmtree(dst)
    shutil.copytree(
        src,
        dst,
        ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
    )


def _copy_file(src: Path, dst: Path) -> None:
    dst.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dst)


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=None,
        help="Repository root to package (defaults to the current repository).",
    )
    return parser.parse_args()


def _rewrite_mcpb_deterministically(path: Path) -> None:
    fixed_dt = (2024, 1, 1, 0, 0, 0)
    temp_path = path.with_suffix(path.suffix + ".tmp")

    with zipfile.ZipFile(path, "r") as src, zipfile.ZipFile(
        temp_path,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
    ) as dst:
        for info in sorted(src.infolist(), key=lambda item: item.filename):
            data = src.read(info.filename)
            rewritten = zipfile.ZipInfo(filename=info.filename, date_time=fixed_dt)
            rewritten.comment = b""
            rewritten.extra = b""
            rewritten.create_system = info.create_system
            rewritten.external_attr = info.external_attr
            rewritten.internal_attr = info.internal_attr
            rewritten.compress_type = info.compress_type
            dst.writestr(rewritten, data, compress_type=info.compress_type)

    temp_path.replace(path)


def main() -> None:
    args = _parse_args()
    repo_root = (args.repo_root or Path(__file__).resolve().parents[1]).resolve()
    pyproject = repo_root / "pyproject.toml"
    version = _read_project_version(pyproject)
    print("Progress: read version", version, "from pyproject.toml")

    frontend_dist = repo_root / "frontend" / "dist" / "index.html"
    if not frontend_dist.is_file():
        print(
            "Progress: frontend/dist/index.html missing — run "
            "'npm ci' and 'npm run build' in frontend/ first.",
            file=sys.stderr,
        )
        sys.exit(1)

    stage = repo_root / "build" / "mcpb_stage"
    print("Progress: staging bundle under", stage)
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)

    _copy_file(pyproject, stage / "pyproject.toml")
    _copy_file(repo_root / "main.py", stage / "main.py")
    _copy_file(repo_root / "LICENSE", stage / "LICENSE")
    _copy_tree(repo_root / "backend", stage / "backend")
    _copy_tree(repo_root / "frontend" / "dist", stage / "frontend" / "dist")

    manifest_src = repo_root / "mcpb" / "manifest.json"
    manifest = json.loads(manifest_src.read_text(encoding="utf-8"))
    if manifest.get("version") != version:
        print(
            "Progress: warning — mcpb/manifest.json version",
            repr(manifest.get("version")),
            "does not match pyproject.toml",
            repr(version),
        )
    shutil.copy2(manifest_src, stage / "manifest.json")

    dist_dir = repo_root / "dist"
    dist_dir.mkdir(parents=True, exist_ok=True)
    out_mcpb = dist_dir / f"batch-review-mcp-{version}.mcpb"
    if out_mcpb.exists():
        out_mcpb.unlink()

    print("Progress: validating manifest with mcpb CLI")
    _mcpb_cli(["validate", str(stage)], cwd=repo_root)

    print("Progress: packing", out_mcpb.name)
    _mcpb_cli(["pack", str(stage), str(out_mcpb)], cwd=repo_root)

    print("Progress: rewriting archive deterministically")
    _rewrite_mcpb_deterministically(out_mcpb)

    digest = hashlib.sha256(out_mcpb.read_bytes()).hexdigest()
    print("Progress: SHA-256", digest)
    print("Progress: wrote", out_mcpb)
    print()
    print("Update server.json packages[0].fileSha256 to:")
    print(digest)


if __name__ == "__main__":
    main()
