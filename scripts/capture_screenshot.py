"""Capture a screenshot of the Batch Review UI for documentation.

Usage:
    uv run python scripts/capture_screenshot.py [--port 7878] [--output docs/screenshot.png]

The script:
1. Starts the batch review server (if not already running)
2. Clears existing comments and loads curated demo comments on README.md
3. Opens README.md in the center panel
4. Takes a 1440x900 viewport screenshot
5. Saves it to the output path

Requirements:
    pip install playwright
    playwright install chromium
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
import urllib.request
import urllib.error
import json
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent

DEMO_COMMENTS = [
    {
        "file_path": "README.md",
        "line_start": 1,
        "line_end": 4,
        "text": (
            "Great introduction! The one-liner clearly communicates the value "
            "proposition. Consider adding a screenshot badge right here for "
            "visual impact when users land on the repo."
        ),
        "highlighted_text": "# Batch Review",
    },
    {
        "file_path": "README.md",
        "line_start": 20,
        "line_end": 35,
        "text": (
            "The features table is very well-organized. Suggest adding a "
            "`Real-time sync` row to highlight that multiple reviewers can see "
            "updates live \u2014 this is a killer feature for team reviews."
        ),
        "highlighted_text": "| Feature | Description |",
    },
    {
        "file_path": "README.md",
        "line_start": 50,
        "line_end": 55,
        "text": (
            "The MCP integration is the standout feature here. Worth calling "
            "out that both Claude and Copilot work out of the box \u2014 many "
            "users won\u2019t realize multi-agent support is included."
        ),
        "highlighted_text": "AI collaboration",
    },
    {
        "file_path": "README.md",
        "line_start": 70,
        "line_end": 75,
        "text": (
            "Node.js is only needed for the one-time `npm run build` step. "
            "Consider noting that pre-built releases ship with `frontend/dist/` "
            "already included, so pip users don\u2019t need Node at all."
        ),
        "highlighted_text": "Requirements",
    },
]


def _is_server_running(base_url: str) -> bool:
    try:
        urllib.request.urlopen(base_url, timeout=2)
        return True
    except Exception:
        return False


def _api(base_url: str, path: str, method: str = "GET", body: dict | None = None):
    url = f"{base_url}{path}"
    data = json.dumps(body).encode() if body else None
    headers = {"Content-Type": "application/json"} if data else {}
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=10) as resp:
        if resp.status in (200, 201):
            return json.loads(resp.read())
        return None


def setup_comments(base_url: str) -> None:
    print("Clearing existing comments...")
    _api(base_url, "/api/comments/clear", method="DELETE")

    print(f"Adding {len(DEMO_COMMENTS)} demo comments...")
    for i, comment in enumerate(DEMO_COMMENTS, 1):
        _api(base_url, "/api/comments", method="POST", body=comment)
        print(f"  [{i}/{len(DEMO_COMMENTS)}] {comment['file_path']}:L{comment['line_start']}-{comment['line_end']}")


def take_screenshot(base_url: str, output_path: Path) -> None:
    from playwright.sync_api import sync_playwright

    output_path.parent.mkdir(parents=True, exist_ok=True)

    print(f"Opening browser at {base_url} ...")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1440, "height": 900})

        page.goto(base_url, wait_until="networkidle")
        page.set_viewport_size({"width": 1440, "height": 900})

        # Click README.md to open it in the center panel
        readme_btn = page.get_by_role("button", name="📝 README.md")
        readme_btn.click()

        # Wait for the markdown to render
        page.wait_for_timeout(1500)

        # Take the screenshot
        page.screenshot(path=str(output_path), type="png")
        browser.close()

    print(f"Screenshot saved to: {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Capture Batch Review UI screenshot")
    parser.add_argument("--port", type=int, default=7878, help="Server port (default: 7878)")
    parser.add_argument(
        "--output",
        type=Path,
        default=REPO_ROOT / "docs" / "screenshot.png",
        help="Output path for the screenshot",
    )
    parser.add_argument(
        "--root",
        type=Path,
        default=REPO_ROOT,
        help="Repo root to pass to the server (default: repo root)",
    )
    args = parser.parse_args()

    base_url = f"http://localhost:{args.port}"

    server_proc = None
    if not _is_server_running(base_url):
        print(f"Starting server on port {args.port}...")
        server_proc = subprocess.Popen(
            [sys.executable, str(REPO_ROOT / "main.py"), "--root", str(args.root),
             "--port", str(args.port), "--no-browser"],
            cwd=str(REPO_ROOT),
        )
        # Wait up to 15 s for the server to come up
        for _ in range(15):
            time.sleep(1)
            if _is_server_running(base_url):
                print("Server is up.")
                break
        else:
            print("ERROR: server did not start in time.", file=sys.stderr)
            server_proc.terminate()
            sys.exit(1)
    else:
        print(f"Server already running at {base_url}")

    try:
        setup_comments(base_url)
        take_screenshot(base_url, args.output)
    finally:
        if server_proc is not None:
            print("Stopping server...")
            server_proc.terminate()


if __name__ == "__main__":
    main()
