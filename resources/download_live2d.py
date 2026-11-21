#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download a Live2D Cubism model and preserve its referenced directory structure.

Usage:
    python download_live2d.py
    python download_live2d.py "https://example.com/path/model.model3.json"
    python download_live2d.py "https://example.com/path/model.model3.json" -o ./models

Requires Python 3.8+; no third-party packages.
"""

import argparse
import json
import os
import time
from pathlib import Path, PurePosixPath
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urljoin, urlsplit
from urllib.request import Request, urlopen

# DEFAULT_URL = (
#     "https://magiaexedralive2dviewer.pages.dev/"
#     "live2d_resources/300230/300230.model3.json"
# )
# DEFAULT_URL = (
#     "https://magiaexedralive2dviewer.pages.dev/"
#     "live2d_resources/100931/100931.model3.json"
# )
DEFAULT_URL = (
    "https://live2d.sakiko.app/live2d-gbp/"
    "039_casual-2023/model.json"
)

def download(url, destination, retries=1):
    """Download atomically, skipping existing nonempty files."""
    if destination.is_file() and destination.stat().st_size > 0:
        print(f"[SKIP] {destination}")
        return True

    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".part")
    for attempt in range(1, retries + 1):
        try:
            request = Request(url, headers={"User-Agent": "Mozilla/5.0 Live2D-resource-downloader"})
            with urlopen(request, timeout=5) as response, temporary.open("wb") as output:
                while True:
                    chunk = response.read(1024 * 256)
                    if not chunk:
                        break
                    output.write(chunk)
            os.replace(temporary, destination)
            print(f"[ OK ] {destination} ({destination.stat().st_size} bytes)")
            return True
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            print(f"[FAIL] {url} (attempt {attempt}/{retries}: {exc})")
            temporary.unlink(missing_ok=True)
            if attempt < retries:
                time.sleep(attempt)
    return False


def resource_paths(model):
    """Collect resources from the standard Live2D Cubism model3.json format."""
    refs = model.get("FileReferences", {})
    found = []

    for key in ("Moc", "Physics", "Pose", "DisplayInfo", "UserData"):
        if isinstance(refs.get(key), str) and refs[key]:
            found.append(refs[key])

    for texture in refs.get("Textures", []):
        if isinstance(texture, str) and texture:
            found.append(texture)

    for group in refs.get("Motions", {}).values():
        for motion in group:
            if not isinstance(motion, dict):
                continue
            for key in ("File", "Sound"):
                if isinstance(motion.get(key), str) and motion[key]:
                    found.append(motion[key])

    for expression in refs.get("Expressions", []):
        if isinstance(expression, dict) and isinstance(expression.get("File"), str):
            found.append(expression["File"])

    return list(dict.fromkeys(found))


def safe_relative_path(value):
    """Reject URLs and absolute/escaping paths from remote manifests."""
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment:
        raise ValueError(f"Unsupported resource path: {value}")
    normalized = value.replace("\\", "/")
    relative = PurePosixPath(normalized)
    if relative.is_absolute() or any(piece in ("..", "") for piece in normalized.split("/")):
        raise ValueError(f"Unsafe resource path: {value}")
    return relative


def main():
    parser = argparse.ArgumentParser(description="Download Live2D model resources")
    parser.add_argument("url", nargs="?", default=DEFAULT_URL, help="model3.json URL")
    parser.add_argument("-o", "--output", default=".", help="Parent download directory (default: current directory)")
    args = parser.parse_args()

    parsed = urlsplit(args.url)
    if parsed.scheme not in ("http", "https") or not parsed.netloc or not parsed.path.endswith(".model3.json"):
        parser.error("Please provide a valid HTTP(S) URL ending in .model3.json")

    model_name = PurePosixPath(parsed.path).name
    directory = Path(args.output).expanduser() / model_name.removesuffix(".model3.json")
    directory.mkdir(parents=True, exist_ok=True)
    manifest = directory / model_name
    print(f"Save directory: {directory.resolve()}")
    if not download(args.url, manifest):
        raise SystemExit("Could not download model manifest")

    try:
        model = json.loads(manifest.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError) as exc:
        raise SystemExit(f"Invalid model manifest: {exc}")

    resources = resource_paths(model)
    print(f"Manifest references {len(resources)} resource files (plus the manifest).")
    base_url = args.url.rsplit("/", 1)[0] + "/"
    failures = []
    for raw in resources:
        try:
            relative = safe_relative_path(raw)
            remote_url = urljoin(base_url, "/".join(quote(part, safe="") for part in relative.parts))
            local = directory.joinpath(*relative.parts)
            if not download(remote_url, local):
                failures.append(raw)
        except ValueError as exc:
            print(f"[SKIP] {exc}")
            failures.append(raw)

    print(f"\nDone: {len(resources) - len(failures) + 1}/{len(resources) + 1} files available.")
    if failures:
        print("Failed resources:")
        for item in failures:
            print("  -", item)
        raise SystemExit(1)
    print(f"Location: {directory.resolve()}")


if __name__ == "__main__":
    main()
