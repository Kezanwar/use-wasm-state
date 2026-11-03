import { copyFileSync, mkdirSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  // Two bundles: the package, and the worker. The worker is its own entry
  // because the main one imports React, which a worker has no business
  // loading. Consumers never import it; createEngine resolves it with
  // new URL("./worker.js", import.meta.url).
  entry: ["src/index.ts", "src/worker.ts"],
  // Each entry self-contained. Splitting would have worker.js import a
  // shared chunk, and a bundler copying worker.js as an asset URL copies
  // only that one file: the worker then 404s on its own chunk, in the
  // production build only. The engine is duplicated instead, which is a
  // few kB against a mode that does not work.
  splitting: false,
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  sourcemap: true,
  // Deliberately off. tsup's treeshake pass is rollup, which strips
  // module-level directives and drops the "use client" banner below with a
  // warning. The package is tiny and marked sideEffects:false, so consumer
  // bundlers tree-shake it fine without this.
  treeshake: false,
  target: "es2022",
  // createEngine resolves the default engine.wasm with
  // new URL("./engine.wasm", import.meta.url). CJS has no import.meta, so
  // tsup rewrites it to a __dirname-based equivalent. Without this the CJS
  // bundle throws on load in Node. test/dist-output.test.ts asserts no
  // bare import.meta survives into dist/index.cjs.
  shims: true,
  // react stays external; it is a peer dependency, never bundled.
  external: ["react"],
  // Required for the Next.js App Router: the hooks are client-only.
  // test/dist-output.test.ts asserts it survives into dist.
  banner: { js: '"use client";' },
  outExtension: ({ format }) => ({ js: format === "esm" ? ".js" : ".cjs" }),
  // The engine is committed, not generated at publish time, so it just gets
  // copied. Consumers resolve it with new URL("./engine.wasm", import.meta.url),
  // which needs the file to sit next to index.js.
  onSuccess: async () => {
    mkdirSync("dist", { recursive: true });
    copyFileSync("src/wasm/engine.wasm", "dist/engine.wasm");
  },
});
