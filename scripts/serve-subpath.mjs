#!/usr/bin/env node
/**
 * Serves the built demo from a sub-directory, the way GitHub Pages does.
 *
 * Pages publishes at /<repo>/, not /, so any absolute asset path such as
 * "/datagrid.wasm" resolves to the domain root and 404s. That breaks only in
 * production, which is the worst place to find out, so the browser suite
 * exercises it against this server.
 *
 * Every route is a pre-rendered page, so a path is a directory with an
 * index.html, the way Pages resolves it. Two variants, by query string on
 * the page, since the router only answers under its basename:
 *
 *   ?badmime  .wasm the page fetches is served as octet-stream, so the test
 *             can prove the loader falls back from compileStreaming
 *   ?csp      the page is served with a strict worker-src
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";

const DIST = resolve(process.cwd(), "examples/react-demo/dist/client");
const BASE = "/use-wasm-state/";
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

createServer(async (req, res) => {
  const { pathname, searchParams } = new URL(req.url ?? "/", "http://localhost");
  if (!pathname.startsWith(BASE)) {
    res.writeHead(404).end("outside the base path, which is the point");
    return;
  }

  // A wasm fetch carries the page that asked for it as its referrer.
  const page = new URL(req.headers.referer ?? req.url ?? "/", "http://localhost").searchParams;
  const badMime = page.has("badmime");
  let file = join(DIST, normalize("/" + pathname.slice(BASE.length)));
  try {
    if ((await stat(file)).isDirectory()) file = join(file, "index.html");
    const body = await readFile(file);
    const ext = extname(file);
    const type =
      badMime && ext === ".wasm"
        ? "application/octet-stream"
        : (TYPES[ext] ?? "application/octet-stream");
    const headers = { "content-type": type };
    if (searchParams.has("csp")) {
      // Only worker-src, which is the one thing this route is for: a page
      // that allows workers from its own origin and nothing else. A blob:
      // worker would be refused here, which is why the package resolves a
      // real worker.js instead. Locking down the rest as well would just
      // be testing Vite's output.
      headers["content-security-policy"] = "worker-src 'self'";
    }
    res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404).end(`not found: ${pathname}`);
  }
}).listen(PORT, () => console.log(`subpath server on http://localhost:${PORT}`));
