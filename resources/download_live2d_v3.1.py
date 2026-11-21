#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Live2D model downloader (Cubism 2 model.json / Cubism 3+ model3.json).

Python 3.8+ standard library only.

Examples:
  python download_live2d.py "https://example.com/live2d/foo/model.model3.json"
  python download_live2d.py --urls-file live2d_adv_urls.txt -o "D:\\Live2D"
  python download_live2d.py URL1 URL2 --workers 8 --overwrite

Downloads first write *.part, then atomically replace the final file.
A SHA-256 cache permits skipping only previously validated files.

Output mirrors the URL host and directory structure, so nested Chinese-language
paths, shared ../ references, and case-sensitive Textures/Motions directories work.
"""
import argparse
import hashlib
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
import json
import os
import posixpath
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urljoin, urlsplit, urlunsplit
from urllib.request import Request, urlopen

DEFAULT_URL = "https://magiaexedralive2dviewer.pages.dev/live2d_resources/300230/300230.model3.json"


def clean_url(value):
    """Normalize URL percent-encoding without double-encoding existing %XX."""
    p = urlsplit(value.strip())
    if p.scheme not in ("http", "https") or not p.hostname or p.username or p.password:
        raise ValueError("Only HTTP(S) URLs without user credentials are allowed")
    if p.query or p.fragment:
        raise ValueError("Manifest/resource URLs with query or fragment are unsupported")
    path = quote(unquote(p.path), safe="/!$&'()*+,;=:@-._~")
    return urlunsplit((p.scheme, p.netloc, path, "", ""))


def url_to_local(url, root):
    """Use site-root-relative location under a host folder, preserving entire hierarchy."""
    parsed = urlsplit(url)
    decoded = unquote(parsed.path)
    parts = decoded.split("/")
    if not decoded.startswith("/") or any(x in ("", ".", "..") for x in parts[1:]):
        raise ValueError(f"Unsafe URL path: {url}")
    if any("\\" in x or "\x00" in x or ":" in x for x in parts[1:]):
        raise ValueError(f"Unsafe filename in URL: {url}")
    hostname = parsed.hostname or "unknown-host"
    if parsed.port:
        hostname += f"_{parsed.port}"
    return root / hostname / Path(*parts[1:])


def resolve_resource(manifest_url, rel):
    if not isinstance(rel, str) or not rel.strip():
        raise ValueError(f"Invalid file path: {rel!r}")
    if "\\" in rel or "\x00" in rel:
        raise ValueError(f"Unsafe resource path: {rel!r}")
    parsed = urlsplit(rel)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment or parsed.path.startswith("/"):
        raise ValueError(f"Expected relative resource path: {rel!r}")
    # Relative ../ is allowed, but only inside the server's URL path root.
    base = urlsplit(manifest_url)
    base_dir = posixpath.dirname(unquote(base.path))
    raw = unquote(rel)
    norm = posixpath.normpath(posixpath.join(base_dir, raw))
    if not norm.startswith("/") or norm == "/":
        raise ValueError(f"Resource path leaves the site root: {rel!r}")
    remote = clean_url(urljoin(manifest_url, quote(raw, safe="/!$&'()*+,;=:@-._~")))
    rp = urlsplit(remote)
    if (rp.scheme, rp.netloc) != (base.scheme, base.netloc):
        raise ValueError(f"Resource moved to another host: {rel!r}")
    return remote


def resource_paths(model):
    """Extract known Cubism 2 and Cubism 3+ file references."""
    found = []
    refs = model.get("FileReferences")
    if isinstance(refs, dict):
        for key in ("Moc", "Physics", "Pose", "DisplayInfo", "UserData"):
            found.append(refs.get(key))
        found.extend(refs.get("Textures") or [])
        motions = refs.get("Motions") or {}
        expressions = refs.get("Expressions") or []
    else:
        for key in ("model", "physics", "pose", "layout", "hit_areas", "init_param", "init_parts_visible"):
            if isinstance(model.get(key), str):
                found.append(model[key])
        found.extend(model.get("textures") or [])
        motions = model.get("motions") or {}
        expressions = model.get("expressions") or []
    if isinstance(motions, dict):
        for group in motions.values():
            if isinstance(group, list):
                for item in group:
                    if isinstance(item, dict):
                        found.extend(item.get(k) for k in ("File", "Sound", "file", "sound"))
    if isinstance(expressions, list):
        for item in expressions:
            if isinstance(item, dict):
                found.extend((item.get("File"), item.get("file")))
    return list(dict.fromkeys(x for x in found if isinstance(x, str) and x.strip()))


class VerifiedCache:
    """Only SHA-256-verified files are eligible for skipping."""

    def __init__(self, root):
        self.root = root
        self.path = root / ".live2d_verified.json"
        self.lock = threading.Lock()
        try:
            self.records = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(self.records, dict):
                self.records = {}
        except (OSError, ValueError):
            self.records = {}

    def key(self, dest):
        return dest.relative_to(self.root).as_posix()

    def is_verified(self, dest):
        entry = self.records.get(self.key(dest))
        if not isinstance(entry, dict) or not dest.is_file():
            return False
        try:
            if dest.stat().st_size != entry.get("size") or entry["size"] <= 0:
                return False
            digest = hashlib.sha256()
            with dest.open("rb") as f:
                for chunk in iter(lambda: f.read(1024 * 1024), b""):
                    digest.update(chunk)
            return digest.hexdigest() == entry.get("sha256")
        except (OSError, KeyError, TypeError):
            return False

    def mark(self, dest, size, digest):
        with self.lock:
            self.records[self.key(dest)] = {"size": size, "sha256": digest}
            tmp = self.path.with_name(self.path.name + ".part")
            try:
                with tmp.open("w", encoding="utf-8") as f:
                    json.dump(self.records, f, ensure_ascii=False, indent=2)
                os.replace(tmp, self.path)
            finally:
                tmp.unlink(missing_ok=True)


def download(url, dest, cache, overwrite=False, retries=3):
    if not overwrite and cache.is_verified(dest):
        return "SKIP", None
    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.with_name(dest.name + ".part")
    last_error = None
    for attempt in range(retries):
        try:
            req = Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "*/*", "Accept-Encoding": "identity"})
            with urlopen(req, timeout=40) as response, temp.open("wb") as out:
                content_length = response.headers.get("Content-Length")
                expected = int(content_length) if content_length is not None else None
                total = 0
                digest = hashlib.sha256()
                while True:
                    chunk = response.read(262144)
                    if not chunk:
                        break
                    out.write(chunk)
                    total += len(chunk)
                    digest.update(chunk)
                out.flush()
                os.fsync(out.fileno())
            if total == 0:
                raise OSError("Empty download")
            if expected is not None and total != expected:
                raise OSError(f"Truncated download: received {total} bytes, expected {expected}")
            # If the server supplies no size/checksum, a clean EOF is not independently
            # provable to be complete; the saved hash verifies future local integrity.
            os.replace(temp, dest)
            cache.mark(dest, total, digest.hexdigest())
            return "OK", None
        except (HTTPError, URLError, TimeoutError, OSError, ValueError) as exc:
            last_error = exc
            temp.unlink(missing_ok=True)
            if attempt + 1 < retries:
                time.sleep(attempt + 1)
    return "FAIL", str(last_error)


def process_model(url, root, cache, overwrite=False, workers=6):
    url = clean_url(url)
    name = unquote(posixpath.basename(urlsplit(url).path))
    if name != "model.json" and not name.endswith(".model3.json"):
        raise ValueError(f"Not a model.json or *.model3.json URL: {url}")
    target = url_to_local(url, root)
    print(f"\nMODEL {url}\nSAVE  {target}", flush=True)
    status, err = download(url, target, cache, overwrite)
    if status == "FAIL":
        print(f"[FAIL] Manifest: {err}", flush=True)
        return False
    try:
        with target.open("r", encoding="utf-8-sig") as f:
            model = json.load(f)
        if not isinstance(model, dict):
            raise ValueError("JSON root is not an object")
    except (OSError, ValueError) as exc:
        print(f"[FAIL] JSON parse: {exc}", flush=True)
        return False
    paths = resource_paths(model)
    jobs = {}
    failures = []
    for rel in paths:
        try:
            resource_url = resolve_resource(url, rel)
            dest = url_to_local(resource_url, root)
            jobs[dest] = resource_url
        except ValueError as exc:
            print(f"[FAIL] {rel} -> {exc}", flush=True)
            failures.append(rel)
    print(f"Found {len(paths)} resources; download tasks {len(jobs)}", flush=True)
    counters = {"OK": 0, "SKIP": 0, "FAIL": 0}
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {pool.submit(download, resource_url, dest, cache, overwrite): (resource_url, dest)
                   for dest, resource_url in jobs.items()}
        for i, future in enumerate(as_completed(futures), 1):
            resource_url, dest = futures[future]
            try:
                status, error = future.result()
            except Exception as exc:
                status, error = "FAIL", str(exc)
            counters[status] += 1
            if status == "FAIL":
                failures.append(resource_url)
                print(f"[{i}/{len(jobs)}] FAIL {resource_url} ({error})", flush=True)
            elif status == "OK":
                print(f"[{i}/{len(jobs)}] OK   {dest}", flush=True)
            elif i % 25 == 0 or i == len(jobs):
                print(f"[{i}/{len(jobs)}] Skipped cached files: {counters['SKIP']}", flush=True)
    print(f"RESULT downloaded={counters['OK']} cached={counters['SKIP']} failed={len(failures)}", flush=True)
    return not failures


def main():
    parser = argparse.ArgumentParser(description="Download Cubism 2 / 3+ Live2D models and assets")
    parser.add_argument("urls", nargs="*", help="Model entry URLs")
    parser.add_argument("--urls-file", help="UTF-8 text file, one model URL per line")
    parser.add_argument("-o", "--output", default=".", help="Destination root (default: current directory)")
    parser.add_argument("--overwrite", action="store_true", help="Redownload nonempty files")
    parser.add_argument("--workers", type=int, default=6, help="Parallel asset requests (default: 6)")
    args = parser.parse_args()
    if not 1 <= args.workers <= 32:
        parser.error("--workers must be 1..32")
    urls = list(args.urls)
    if args.urls_file:
        try:
            lines = Path(args.urls_file).read_text(encoding="utf-8-sig").splitlines()
        except OSError as exc:
            parser.error(str(exc))
        urls.extend(line.strip() for line in lines if line.strip() and not line.lstrip().startswith("#"))
    urls = list(dict.fromkeys(urls or [DEFAULT_URL]))
    root = Path(args.output).expanduser().resolve()
    root.mkdir(parents=True, exist_ok=True)
    cache = VerifiedCache(root)
    success = 0
    for i, url in enumerate(urls, 1):
        print(f"\n=== Model {i}/{len(urls)} ===", flush=True)
        try:
            success += bool(process_model(url, root, cache, args.overwrite, args.workers))
        except ValueError as exc:
            print(f"[FAIL] {exc}", flush=True)
    print(f"\nCompleted: {success}/{len(urls)} models", flush=True)
    if success != len(urls):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
