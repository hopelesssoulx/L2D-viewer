#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Download Live2D Cubism 2 (model.json) and Cubism 3+ (model3.json).

Examples:
  python download_live2d.py
  python download_live2d.py https://live2d.sakiko.app/live2d-gbp/034_school_winter/model.json
  python download_live2d.py URL1 URL2 URL3 -o D:\\Live2D

Only Python 3.8+ standard library is required. Directories referenced with ../
are preserved under the output root (e.g. 034_general next to 034_school_winter).
"""
import argparse
import json
import os
import posixpath
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urljoin, urlsplit
from urllib.request import Request, urlopen

DEFAULT_URL = (
    "https://live2d.sakiko.app/live2d-gbp/"
    "029_live_r_2023/model.json"
)


def download(url, destination, retries=1, overwrite=False):
    if not overwrite and destination.is_file() and destination.stat().st_size > 0:
        print(f"[SKIP] {destination}")
        return True
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".part")
    for attempt in range(1, retries + 1):
        try:
            request = Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urlopen(request, timeout=5) as response, temporary.open("wb") as output:
                while True:
                    chunk = response.read(256 * 1024)
                    if not chunk:
                        break
                    output.write(chunk)
            os.replace(temporary, destination)
            print(f"[ OK ] {destination} ({destination.stat().st_size} bytes)")
            return True
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            print(f"[FAIL] {url} ({attempt}/{retries}: {exc})")
            temporary.unlink(missing_ok=True)
            if attempt < retries:
                time.sleep(attempt)
    return False


def resource_paths(model):
    """Extract resources from the two common Live2D manifest schemas."""
    found = []
    refs = model.get("FileReferences")
    if isinstance(refs, dict):
        # Cubism 3/4/5
        for key in ("Moc", "Physics", "Pose", "DisplayInfo", "UserData"):
            found.append(refs.get(key))
        found.extend(refs.get("Textures") or [])
        motions = refs.get("Motions") or {}
        expressions = refs.get("Expressions") or []
    else:
        # Cubism 2
        for key in ("model", "physics", "pose", "layout", "hit_areas", "init_param", "init_parts_visible"):
            value = model.get(key)
            if isinstance(value, str):
                found.append(value)
        found.extend(model.get("textures") or [])
        motions = model.get("motions") or {}
        expressions = model.get("expressions") or []

    if isinstance(motions, dict):
        for group in motions.values():
            if not isinstance(group, list):
                continue
            for motion in group:
                if isinstance(motion, dict):
                    found.extend((motion.get("File"), motion.get("Sound"),
                                  motion.get("file"), motion.get("sound")))
    if isinstance(expressions, list):
        for expression in expressions:
            if isinstance(expression, dict):
                found.extend((expression.get("File"), expression.get("file")))
    return list(dict.fromkeys(x for x in found if isinstance(x, str) and x.strip()))


def resolve_resource(manifest_url, raw, output_root, model_dir):
    """Resolve remote URL and local target, allowing sibling ../ paths safely."""
    if not isinstance(raw, str) or not raw.strip() or "\\" in raw:
        raise ValueError(f"Invalid resource path: {raw!r}")
    raw_parts = urlsplit(raw)
    if raw_parts.scheme or raw_parts.netloc or raw_parts.query or raw_parts.fragment:
        raise ValueError(f"External or unsupported resource path: {raw!r}")
    decoded = unquote(raw_parts.path)
    if not decoded or decoded.startswith("/") or "\x00" in decoded:
        raise ValueError(f"Invalid resource path: {raw!r}")
    # Work relative to manifest's directory. Preserve ../ paths pointing at siblings.
    relative = posixpath.normpath(posixpath.join(model_dir, decoded))
    if relative in ("", ".", "..") or relative.startswith("../"):
        raise ValueError(f"Path leaves output root: {raw!r}")
    remote = urljoin(manifest_url, quote(decoded, safe="/.-_~%"))
    remote_parts = urlsplit(remote)
    base_parts = urlsplit(manifest_url)
    if (remote_parts.scheme, remote_parts.netloc) != (base_parts.scheme, base_parts.netloc):
        raise ValueError(f"URL crosses hosts: {raw!r}")
    return remote, output_root.joinpath(*relative.split("/"))


def process_model(url, output_root, overwrite=False):
    parsed = urlsplit(url)
    filename = unquote(posixpath.basename(parsed.path))
    if parsed.scheme not in ("http", "https") or not parsed.netloc or not (
        filename == "model.json" or filename.endswith(".model3.json")
    ):
        raise ValueError(f"Expected an HTTP(S) model.json or *.model3.json URL: {url}")
    model_dir = unquote(posixpath.basename(posixpath.dirname(parsed.path)))
    if not model_dir or model_dir in (".", "..") or "/" in model_dir or "\\" in model_dir:
        raise ValueError(f"Invalid model directory in URL: {url}")
    target_dir = output_root / model_dir
    manifest = target_dir / filename
    print(f"\n=== {url} ===\nSaving to: {target_dir.resolve()}")
    if not download(url, manifest, overwrite=overwrite):
        return False
    try:
        with manifest.open("r", encoding="utf-8-sig") as f:
            model = json.load(f)
        if not isinstance(model, dict):
            raise ValueError("JSON root must be an object")
    except (OSError, ValueError) as exc:
        print(f"[ERROR] Invalid manifest: {exc}")
        return False

    resources = resource_paths(model)
    print(f"Referenced resources: {len(resources)} (+ 1 manifest)")
    failures = []
    for raw in resources:
        try:
            remote, destination = resolve_resource(url, raw, output_root, model_dir)
        except ValueError as exc:
            print(f"[ERROR] {exc}")
            failures.append(raw)
            continue
        if not download(remote, destination, overwrite=overwrite):
            failures.append(raw)
    print(f"Result: {len(resources) + 1 - len(failures)}/{len(resources) + 1} available")
    if failures:
        print("Failed resources:\n" + "\n".join(f"  {x}" for x in failures))
    return not failures


def main():
    parser = argparse.ArgumentParser(description="Download Live2D Cubism 2 and 3+ resources")
    parser.add_argument("urls", nargs="*", help="One or more model.json / model3.json URLs")
    parser.add_argument("-o", "--output", default=".", help="Root folder for model directories")
    parser.add_argument("--overwrite", action="store_true", help="Download existing files again")
    args = parser.parse_args()
    output_root = Path(args.output).expanduser().resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    urls = args.urls or [DEFAULT_URL]
    successes = 0
    for url in urls:
        try:
            successes += bool(process_model(url, output_root, args.overwrite))
        except ValueError as exc:
            print(f"[ERROR] {exc}")
    print(f"\nCompleted models: {successes}/{len(urls)}")
    if successes != len(urls):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
