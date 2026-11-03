import { copyFileSync, mkdirSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  // The root, every pattern, and each pattern's worker. A worker is its own
  // entry because the main ones import React, which a worker has no
  // business loading. Consumers never import it; the datagrid resolves it
  // with new URL("./datagrid.worker.js", import.meta.url).
  entry: {
    index: "src/index.ts",
    datagrid: "src/datagrid/index.ts",
    "datagrid.worker": "src/datagrid/worker.ts",
  },
  // Each entry self-contained. Splitting would have them import a shared
  // chunk, and a bundler copying datagrid.worker.js as an asset URL copies
  // only that one file: the worker then 404s on its chunk, in the
  // production build only. Shared code is duplicated instead; the two
  // things that must stay single across copies, the provider contexts and
  // WasmStateError, are keyed on global symbols. See src/core/context.ts.
  splitting: false,
  format: ["esm", "cjs"],
  // Types for what a consumer imports. The worker is an asset loaded by URL,
  // so it gets none; its CJS twin is built and left out of the package.
  dts: { entry: { index: "src/index.ts", datagrid: "src/datagrid/index.ts" } },
  clean: true,
  // No source maps in the package. Nothing is minified, so a stack trace
  // already reads as the source, and maps would more than double what every
  // install downloads.
  sourcemap: false,
  // Deliberately off. tsup's treeshake pass is rollup, which strips
  // module-level directives and drops the "use client" banner below with a
  // warning. The package is tiny and marked sideEffects:false, so consumer
  // bundlers tree-shake it fine without this.
  treeshake: false,
  target: "es2022",
  // The datagrid resolves its engine with
  // new URL("./datagrid.wasm", import.meta.url). CJS has no import.meta, so
  // tsup rewrites it to a __dirname-based equivalent. Without this the CJS
  // bundle throws on load in Node. test/dist-output.test.ts asserts no
  // bare import.meta survives into any .cjs.
  shims: true,
  // react stays external; it is a peer dependency, never bundled.
  external: ["react"],
  // Required for the Next.js App Router: the hooks are client-only.
  // test/dist-output.test.ts asserts it survives into dist.
  banner: { js: '"use client";' },
  outExtension: ({ format }) => ({ js: format === "esm" ? ".js" : ".cjs" }),
  // The engine is committed, not generated at publish time, so it just gets
  // copied. The datagrid resolves it with
  // new URL("./datagrid.wasm", import.meta.url), which needs the file to
  // sit next to datagrid.js.
  onSuccess: async () => {
    mkdirSync("dist", { recursive: true });
    copyFileSync("src/datagrid/datagrid.wasm", "dist/datagrid.wasm");
  },
});
