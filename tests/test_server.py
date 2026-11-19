import io
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from http.server import ThreadingHTTPServer
from pathlib import Path

from lrmask.server import App, make_handler
from lrmask.sources import Catalog, Source

FIXTURES = Path(__file__).with_name("fixtures")


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        catalog = Catalog([Source("folder", "Fixtures", [FIXTURES])])
        catalog.refresh()
        self.app = App(catalog, Path(self.tmp.name) / "output")
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(self.app))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.tmp.cleanup()

    def request(self, path, body=None, token=True, headers=None):
        data = json.dumps(body).encode() if isinstance(body, dict) else body
        req = urllib.request.Request(self.base + path, data=data, headers=headers or {})
        if token:
            req.add_header("X-Token", self.app.token)
        try:
            with urllib.request.urlopen(req) as res:
                return res.status, json.loads(res.read())
        except urllib.error.HTTPError as err:
            return err.code, json.loads(err.read())

    def test_page_embeds_token(self):
        with urllib.request.urlopen(self.base + "/") as res:
            self.assertIn(self.app.token, res.read().decode())

    def test_api_requires_token(self):
        status, _ = self.request("/api/presets", token=False)
        self.assertEqual(status, 403)

    def test_list_preview_convert(self):
        status, data = self.request("/api/presets")
        self.assertEqual(status, 200)
        ids = {p["name"]: p["id"] for p in data["presets"]}
        self.assertEqual(set(ids), {"Moody & Warm", "Mono Fade"})

        status, preview = self.request(f"/api/preview?id={ids['Moody & Warm']}&target=background")
        self.assertEqual(status, 200)
        self.assertEqual(preview["outputGroup"], "Background · Test Looks")
        self.assertIn("MainCurve", preview["curves"])

        status, result = self.request("/api/convert", {"ids": list(ids.values()), "target": "background"})
        self.assertEqual(status, 200)
        self.assertEqual(result["count"], 2)
        with zipfile.ZipFile(result["zip"]) as archive:
            self.assertEqual(len([n for n in archive.namelist() if n.endswith(".xmp")]), 2)

    def test_upload_zip(self):
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as archive:
            archive.write(FIXTURES / "full_look.xmp", "pack/full_look.xmp")
            archive.writestr("__MACOSX/pack/._full_look.xmp", b"junk")
        status, result = self.request("/api/upload", buf.getvalue(), headers={"X-Filename": "pack.zip"})
        self.assertEqual(status, 200)
        self.assertEqual(len(result["added"]), 1)
        self.assertEqual(result["errors"], [])

    def test_reveal_refuses_paths_outside_output(self):
        status, _ = self.request("/api/reveal", {"path": "/etc/hosts"})
        self.assertEqual(status, 400)


if __name__ == "__main__":
    unittest.main()
