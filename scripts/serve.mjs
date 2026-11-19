// Serve the web version locally: node scripts/serve.mjs [port]
// Only listens on 127.0.0.1 and only serves files inside web/.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../web/", import.meta.url));
const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml",
  ".png": "image/png", ".xmp": "application/rdf+xml; charset=utf-8", ".ico": "image/x-icon",
};

/** `routes` maps extra paths to HTML strings (used by the docs capture script). */
export function serve(port = 0, routes = {}) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      if (routes[url.pathname]) {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
        return res.end(routes[url.pathname]);
      }
      let path = normalize(join(ROOT, decodeURIComponent(url.pathname)));
      if (!path.startsWith(ROOT.replace(/[\\/]$/, "") + sep) && path !== ROOT.replace(/[\\/]$/, "")) throw Object.assign(new Error("outside"), { code: "ENOENT" });
      if (path.endsWith(sep) || path === ROOT.replace(/[\\/]$/, "")) path = join(path, "index.html");
      const body = await readFile(path);
      res.writeHead(200, { "content-type": TYPES[extname(path)] || "application/octet-stream", "cache-control": "no-store" });
      res.end(body);
    } catch (err) {
      res.writeHead(err.code === "ENOENT" || err.code === "EISDIR" ? 404 : 500, { "content-type": "text/plain" });
      res.end("Not found");
    }
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await serve(Number(process.argv[2]) || 8765);
  console.log(`Partly (web) at http://127.0.0.1:${server.address().port}/`);
}
