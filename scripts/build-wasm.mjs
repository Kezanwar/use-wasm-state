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
const built = run("tinygo", ["build", "-target=wasm-unknown", "-no-debug", "-o", out, "."], {
  cwd: resolve(root, "engine"),
});
if (built !== 0) exit(built);

console.log();
// No allow-list: this engine imports nothing at all.
exit(run("node", [resolve(root, "scripts/inspect-wasm.mjs"), out]));
