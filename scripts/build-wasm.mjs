#!/usr/bin/env node
/**
 * Rebuilds the bundled engine from engine/ into src/datagrid/datagrid.wasm, then
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
 * -gc=precise is chosen over this target's default, which is `leaking`: a
 * collector that never reclaims anything, so a long-lived table only ever
 * grows. Measured over 400k rows arriving in batches, leaking reached 32MB
 * of linear memory where precise held at 16MB, and a 200k-row insert costs
 * 18ms against leaking's 13ms. Ten kilobytes of module size and 1.4x on the
 * one bulk call buys memory that comes back.
 *
 * -gc=conservative was measured and rejected: same flat memory, but a 200k
 * insert takes 1,700ms, because every allocation may scan a heap growing
 * into the megabytes.
 *
 * The engine is built to allocate almost nothing in steady state (see
 * "Memory model" in the architecture notes), so the collector should have
 * little to do between loads. Re-measure with scripts/bench-engine.mjs
 * before changing this.
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exit } from "node:process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = resolve(root, "src/datagrid/datagrid.wasm");

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

console.log("building src/datagrid/datagrid.wasm");
const built = run(
  "tinygo",
  ["build", "-target=wasm-unknown", "-gc=precise", "-no-debug", "-o", out, "."],
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
