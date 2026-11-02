#!/usr/bin/env node
/**
 * Rebuilds the bundled engine from engine/ into src/wasm/engine.wasm, then
 * audits it.
 *
 * Requires TinyGo: https://tinygo.org/getting-started/install/
 *   macOS: brew tap tinygo-org/tools && brew install tinygo
 *
 * The built file is committed, so the tests and the demo run without TinyGo
 * installed. Only rebuild when engine/ changes.
 *
 * -target=wasm-unknown is the no-WASI target: the module imports nothing and
 * reaches the host only through its own exports. Keeping it that way is what
 * inspect-wasm.mjs checks, and it is why the engine can run identically on
 * the main thread, in a worker, and in Node under vitest.
 *
 * -gc=leaking is this target's default, pinned here so a TinyGo upgrade
 * cannot change it silently. It never reclaims anything, which is a real
 * limitation: the engine allocates per call, so linear memory doubles every
 * so many inserts and never comes back down (measured: 32MB after 400k rows
 * arriving in batches).
 *
 * -gc=conservative fixes that, and was measured and rejected. It holds
 * memory flat but takes a 200k-row insertColumns from 11ms to 1,700ms,
 * because every allocation may trigger a scan of a heap that is growing
 * into the megabytes. A 156x regression on the one call the flagship demo
 * makes is worse than the leak. Revisit when TinyGo's wasm GC improves, or
 * when the engine stops allocating per row; benchmark with
 * scripts/bench-engine.mjs before changing this.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exit } from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "src/wasm/engine.wasm");

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.error?.code === "ENOENT") return null;
  return res.status ?? 1;
}

if (run("tinygo", ["version"], { stdio: "ignore" }) === null) {
  console.error("tinygo not found. Install it: https://tinygo.org/getting-started/install/");
  exit(1);
}

mkdirSync(dirname(out), { recursive: true });

console.log("building src/wasm/engine.wasm");
const built = run(
  "tinygo",
  ["build", "-target=wasm-unknown", "-gc=leaking", "-no-debug", "-o", out, "."],
  {
    cwd: resolve(root, "engine"),
  }
);
if (built !== 0) exit(built);

console.log();
// No allow-list: this engine imports nothing at all. The manifest also
// pins the export list, so an accidental //go:wasmexport fails the build.
exit(
  run("node", [
    resolve(root, "scripts/inspect-wasm.mjs"),
    out,
    "--expect-exports-from",
    resolve(root, "scripts/engine-exports.mjs"),
  ])
);
