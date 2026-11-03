#!/usr/bin/env node
/**
 * Serves the built demo from a sub-directory, the way GitHub Pages does.
 *
 * Pages publishes at /<repo>/, not /, so any absolute asset path such as
 * "/engine.wasm" resolves to the domain root and 404s. That breaks only in
 * production, which is the worst place to find out, so the browser suite
 * exercises it against this server.
 *
 *   /use-wasm-state/  the real thing, .wasm served as application/wasm
 *   /badmime/         .wasm served as octet-stream, so the test can prove
 *                     the loader falls back from compileStreaming to compile
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const DIST = resolve(process.cwd(), "examples/react-demo/dist");
const PORT = Number(process.env.SUBPATH_PORT ?? 4178);

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

const ROUTES = [
  ["/use-wasm-state/", false],
  ["/badmime/", true],
];

createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");
  const route = ROUTES.find(([prefix]) => pathname.startsWith(prefix));
  if (!route) {
    res.writeHead(404).end("outside the base path, which is the point");
    return;
  }

  const [prefix, badMime] = route;
  const file = join(DIST, normalize("/" + (pathname.slice(prefix.length) || "index.html")));
  try {
    const body = await readFile(file);
    const ext = extname(file);
    const type =
      badMime && ext === ".wasm"
        ? "application/octet-stream"
        : (TYPES[ext] ?? "application/octet-stream");
    res.writeHead(200, { "content-type": type }).end(body);
  } catch {
    res.writeHead(404).end(`not found: ${pathname}`);
  }
}).listen(PORT, () => console.log(`subpath server on http://localhost:${PORT}`));
