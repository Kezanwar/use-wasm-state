#!/usr/bin/env node
/**
 * Measures typical JS, tuned JS and the engine on the same 200k-row dataset
 * and writes benchmarks.json, which the README and the docs site render
 * their figures from. Then regenerates the README's block from it.
 *
 *   pnpm bench                 15 repeats
 *   pnpm bench -- --repeats 5  quicker, noisier
 *
 * The runner is the one the Benchmarks tab runs in a browser, bundled here
 * the way the package is, so the published numbers and the live ones are
 * one measurement on two machines.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { cpus, platform, release, arch, totalmem, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { argv, exit, version as nodeVersion, versions } from "node:process";
import { build } from "tsup";
import { writeReadme } from "./readme-benchmarks.mjs";

const root = resolve(import.meta.dirname, "..");
const at = argv.indexOf("--repeats");
const repeats = at === -1 ? 15 : Number(argv[at + 1]);

if (typeof globalThis.gc !== "function") {
  console.error(
    "Run with --expose-gc (pnpm bench does), so memory is measured after a collection."
  );
  exit(1);
}

const outDir = mkdtempSync(join(tmpdir(), "use-wasm-state-bench-"));
await build({
  entry: { bench: resolve(root, "scripts/bench-entry.ts") },
  format: ["esm"],
  outDir,
  target: "es2022",
  platform: "node",
  config: false,
  silent: true,
  dts: false,
  external: ["react"],
  esbuildOptions(options) {
    options.alias = {
      "use-wasm-state/datagrid": resolve(root, "src/datagrid/index.ts"),
      "use-wasm-state": resolve(root, "src/index.ts"),
    };
  },
});
const { implementations, runBenchmarks } = await import(
  pathToFileURL(join(outDir, "bench.js")).href
);

// The engine loads over fetch, which cannot read a local path. Serve the
// committed module the way the tests do, so the real load path is timed.
const wasm = readFileSync(resolve(root, "src/datagrid/datagrid.wasm"));
const WASM_URL = "https://bench.local/datagrid.wasm";
globalThis.fetch = async () =>
  new Response(wasm, { headers: { "content-type": "application/wasm" } });

// Heap plus typed-array storage, which is where a columnar baseline keeps
// its data. Wasm linear memory is not in either; it is reported on its own.
// Two collections, because one can leave garbage the first one freed the
// references to.
const memory = () => {
  globalThis.gc();
  globalThis.gc();
  const { heapUsed, arrayBuffers } = process.memoryUsage();
  return heapUsed + arrayBuffers;
};

let last = "";
const results = await runBenchmarks(implementations(WASM_URL), {
  repeats,
  memory,
  onProgress(done, total, label) {
    const line = `  ${String(done).padStart(2)}/${total}  ${label}`;
    if (line !== last) console.log((last = line));
  },
});

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const commit = (() => {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: root }).toString().trim();
  } catch {
    return null;
  }
})();

const figures = {
  measured: new Date().toISOString().slice(0, 10),
  machine: {
    cpu: cpus()[0]?.model.trim() ?? "unknown",
    cores: cpus().length,
    memoryGB: Math.round(totalmem() / 2 ** 30),
    os: `${platform()} ${release()} ${arch()}`,
  },
  runtime: { name: "Node", version: nodeVersion, v8: versions.v8 },
  package: { version: pkg.version, commit },
  ...results,
};

writeFileSync(resolve(root, "benchmarks.json"), JSON.stringify(figures, null, 2) + "\n");
console.log("\nwrote benchmarks.json");
writeReadme();
console.log("updated the README's benchmark block");
