"""The local web app. It listens on 127.0.0.1 only, and every API call needs the per-launch token
embedded in the page, so other websites open in your browser can't drive it."""
from __future__ import annotations

import json
import secrets
import subprocess
import threading
import webbrowser
from dataclasses import asdict
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from . import curves
from .mapping import Options, convert
from .sources import Catalog
from .writer import DEFAULT_GROUP_TEMPLATE, TARGETS, group_name, write_batch

STATIC = Path(__file__).with_name("static")
MAX_UPLOAD = 50 * 1024 * 1024
SOURCE_ORDER = ("lightroom", "uploaded", "folder", "cameraraw", "adobe")
SOURCE_LABELS = {"uploaded": "Added files"}


class App:
    def __init__(self, catalog: Catalog, out_dir):
        self.catalog = catalog
        self.out_dir = Path(out_dir).resolve()
        self.token = secrets.token_urlsafe(24)

    def presets(self, query: dict) -> dict:
        if query.get("refresh"):
            self.catalog.refresh()
        options = _options(query)
        labels = {**{s.key: s.label for s in self.catalog.sources}, **SOURCE_LABELS}
        rows = []
        for entry in self.catalog.all():
            conv = convert(entry.preset, options)
            rows.append({
                "id": entry.id, "name": entry.preset.name, "group": entry.preset.group, "source": entry.source,
                "converted": entry.preset.converted, "coverage": round(conv.coverage, 3), "empty": conv.empty,
            })
        counts = {}
        for row in rows:
            counts[row["source"]] = counts.get(row["source"], 0) + 1
        sources = [{"key": k, "label": labels.get(k, k), "count": counts[k]} for k in SOURCE_ORDER if counts.get(k)]
        return {"presets": rows, "sources": sources, "outDir": str(self.out_dir), "skipped": len(self.catalog.skipped),
                "groupTemplate": DEFAULT_GROUP_TEMPLATE}

    def preview(self, query: dict) -> dict:
        entry = self.catalog.get(query.get("id", ""))
        if entry is None:
            raise ApiError("That preset is no longer available. Try Refresh.", HTTPStatus.NOT_FOUND)
        target = _target(query.get("target"))
        conv = convert(entry.preset, _options(query))
        preset = entry.preset
        return {
            "id": entry.id, "name": preset.name, "group": preset.group, "source": entry.source,
            "converted": preset.converted, "maskCount": preset.mask_count, "empty": conv.empty,
            "coverage": round(conv.coverage, 3),
            "counts": {s: conv.count(s) for s in ("exact", "approx", "lost")},
            "rows": [asdict(r) for r in conv.rows],
            "curves": {k: curves.samples(v) for k, v in conv.curves.items()},
            "outputGroup": group_name(preset, target, query.get("groupTemplate") or DEFAULT_GROUP_TEMPLATE),
        }

    def convert(self, body: dict) -> dict:
        target = _target(body.get("target"))
        options = Options(**{k: bool(v) for k, v in (body.get("options") or {}).items() if k in Options.__dataclass_fields__})
        template = str(body.get("groupTemplate") or DEFAULT_GROUP_TEMPLATE)[:200]
        jobs, skipped = [], []
        for entry_id in body.get("ids") or []:
            entry = self.catalog.get(str(entry_id))
            if entry is None:
                skipped.append({"name": entry_id, "reason": "not found"})
                continue
            conv = convert(entry.preset, options)
            if conv.empty:
                skipped.append({"name": entry.preset.name, "reason": "nothing in it can go into a mask"})
                continue
            jobs.append((entry.preset, conv, group_name(entry.preset, target, template)))
        if not jobs:
            raise ApiError("None of the selected presets have settings a mask can hold.")
        result = write_batch(jobs, self.out_dir, target)
        return {
            "count": len(jobs), "target": TARGETS[target]["label"], "zip": str(result["zip"]),
            "folder": str(result["folder"]), "groups": sorted({g for _, _, g in jobs}), "skipped": skipped,
        }

    def upload(self, filename: str, data: bytes) -> dict:
        added, errors = self.catalog.add_upload(filename, data)
        return {"added": [e.id for e in added], "errors": errors}

    def reveal(self, body: dict) -> dict:
        path = Path(str(body.get("path", ""))).resolve()
        if self.out_dir not in path.parents and path != self.out_dir:
            raise ApiError("Can only reveal files this app created.")
        self.out_dir.mkdir(parents=True, exist_ok=True)
        subprocess.run(["open", "-R", str(path)] if path.exists() else ["open", str(self.out_dir)], check=False)
        return {"ok": True}


class ApiError(Exception):
    def __init__(self, message: str, status: HTTPStatus = HTTPStatus.BAD_REQUEST):
        super().__init__(message)
        self.status = status


def make_handler(app: App):
    class Handler(BaseHTTPRequestHandler):
        server_version = "LRMaskPresets"

        def log_message(self, *args):
            pass

        def do_GET(self):
            url = urlparse(self.path)
            if not self._host_ok():
                return self._json({"error": "bad host"}, HTTPStatus.FORBIDDEN)
            if url.path in ("/", "/index.html"):
                page = (STATIC / "index.html").read_text(encoding="utf-8").replace("__TOKEN__", app.token)
                return self._send(page.encode(), "text/html; charset=utf-8")
            query = {k: v[-1] for k, v in parse_qs(url.query).items()}
            routes = {"/api/presets": app.presets, "/api/preview": app.preview}
            self._api(routes.get(url.path), query)

        def do_POST(self):
            url = urlparse(self.path)
            if not self._host_ok():
                return self._json({"error": "bad host"}, HTTPStatus.FORBIDDEN)
            length = int(self.headers.get("Content-Length") or 0)
            if length > MAX_UPLOAD:
                return self._json({"error": "Upload is larger than 50 MB."}, HTTPStatus.REQUEST_ENTITY_TOO_LARGE)
            raw = self.rfile.read(length)
            if url.path == "/api/upload":
                filename = unquote(self.headers.get("X-Filename") or "upload.xmp")
                return self._api(lambda _: app.upload(filename, raw), None)
            try:
                body = json.loads(raw or b"{}")
            except ValueError:
                return self._json({"error": "Expected JSON."}, HTTPStatus.BAD_REQUEST)
            routes = {"/api/convert": app.convert, "/api/reveal": app.reveal}
            self._api(routes.get(url.path), body)

        def _api(self, handler, arg):
            if handler is None:
                return self._json({"error": "Not found."}, HTTPStatus.NOT_FOUND)
            if not secrets.compare_digest(self.headers.get("X-Token", ""), app.token):
                return self._json({"error": "Missing or wrong token. Reload the page."}, HTTPStatus.FORBIDDEN)
            try:
                self._json(handler(arg))
            except ApiError as exc:
                self._json({"error": str(exc)}, exc.status)
            except Exception as exc:  # keep the app alive and show the problem in the page
                self._json({"error": f"{type(exc).__name__}: {exc}"}, HTTPStatus.INTERNAL_SERVER_ERROR)

        def _host_ok(self) -> bool:
            host = (self.headers.get("Host") or "").rsplit(":", 1)[0]
            return host in ("127.0.0.1", "localhost")

        def _json(self, payload, status=HTTPStatus.OK):
            self._send(json.dumps(payload).encode(), "application/json", status)

        def _send(self, body: bytes, content_type: str, status=HTTPStatus.OK):
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            if content_type.startswith("text/html"):
                self.send_header("Content-Security-Policy",
                                 "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:")
            self.end_headers()
            self.wfile.write(body)

    return Handler


def serve(app: App, port: int = 8765, open_browser: bool = True) -> None:
    server = None
    for candidate in range(port, port + 20):
        try:
            server = ThreadingHTTPServer(("127.0.0.1", candidate), make_handler(app))
            break
        except OSError:
            continue
    if server is None:
        raise SystemExit(f"No free port between {port} and {port + 19}.")
    url = f"http://127.0.0.1:{server.server_address[1]}/"
    print(f"LR Mask Presets is running at {url}", flush=True)
    print(f"New presets are saved in {app.out_dir}", flush=True)
    print("Press Ctrl+C to stop.", flush=True)
    if open_browser:
        threading.Timer(0.4, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


def _options(query: dict) -> Options:
    defaults = Options()
    return Options(**{k: query.get(k, "1" if getattr(defaults, k) else "0") == "1"
                      for k in Options.__dataclass_fields__})


def _target(value) -> str:
    if value in (None, ""):
        return "background"
    if value not in TARGETS:
        raise ApiError(f"Unknown mask: {value}")
    return value
