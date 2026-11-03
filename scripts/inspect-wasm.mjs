#!/usr/bin/env node
/**
 * Lists a module's imports and exports, and fails if either has drifted.
 * Stands in for `wasm-objdump -x` so the check needs no wabt install.
 *
 * Imports: the engine is built for -target=wasm-unknown and talks to the
 * host only through its own exports, so the expected allow-list is empty.
 * Any import at all is a regression, usually a stray WASI dependency.
 *
 * Exports: with --expect-exports-from, the module must export everything
 * the manifest requires and nothing it does not tolerate. An export added
 * by accident is as much a break as one that went missing: it is public
 * surface the JS bindings do not know about.
 *
 * Usage:
 *   node scripts/inspect-wasm.mjs <file.wasm>
 *   node scripts/inspect-wasm.mjs <file.wasm> --allow-imports env.log
 *   node scripts/inspect-wasm.mjs <file.wasm> --expect-exports-from scripts/engine-exports.mjs
 */
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { argv, exit } from "node:process";

const [, , file, ...flags] = argv;
if (!file) {
  console.error(
    "usage: inspect-wasm.mjs <file.wasm> [--allow-imports a.b,c.d] [--expect-exports-from manifest.mjs]"
  );
  exit(2);
}

const flagValue = (name) => {
  const i = flags.indexOf(name);
  return i === -1 ? undefined : flags[i + 1];
};

const allowed = new Set((flagValue("--allow-imports") ?? "").split(",").filter(Boolean));
const manifestPath = flagValue("--expect-exports-from");

const bytes = await readFile(file);
const mod = await WebAssembly.compile(bytes);
const imports = WebAssembly.Module.imports(mod);
const exports = WebAssembly.Module.exports(mod);

console.log(`${file}  (${bytes.length} bytes)`);
console.log("\nimports:");
if (imports.length === 0) console.log("  (none)");
for (const i of imports) console.log(`  ${i.module}.${i.name}  [${i.kind}]`);

console.log("\nexports:");
for (const e of exports) console.log(`  ${e.name}  [${e.kind}]`);

const problems = [];

const unexpectedImports = imports
  .map((i) => `${i.module}.${i.name}`)
  .filter((n) => !allowed.has(n));
if (unexpectedImports.length) {
  problems.push(
    `unexpected imports: ${unexpectedImports.join(", ")}\n` +
      `  The engine must import nothing from the host. A WASI import here usually\n` +
      `  means the build dropped off -target=wasm-unknown.`
  );
}

if (manifestPath) {
  const manifest = await import(pathToFileURL(resolve(manifestPath)).href);
  const present = new Set(exports.map((e) => e.name));
  const known = new Set([...manifest.REQUIRED_EXPORTS, ...manifest.TOLERATED_EXPORTS]);

  const missing = manifest.REQUIRED_EXPORTS.filter((n) => !present.has(n));
  if (missing.length) {
    problems.push(
      `missing exports: ${missing.join(", ")}\n` +
        `  Declared in ${manifestPath} but not in the module. Did a //go:wasmexport\n` +
        `  get dropped, or the build run against stale source?`
    );
  }

  const extra = [...present].filter((n) => !known.has(n));
  if (extra.length) {
    problems.push(
      `unexpected exports: ${extra.join(", ")}\n` +
        `  Public surface the JS bindings do not know about. Add it to\n` +
        `  ${manifestPath} and src/datagrid/abi.ts, or stop exporting it. A TinyGo\n` +
        `  upgrade that adds a libm shim lands here too; list it as tolerated.`
    );
  }
}

if (problems.length) {
  console.error(`\n${problems.join("\n\n")}`);
  exit(1);
}

console.log("\nimports OK");
if (manifestPath) console.log("exports OK");
