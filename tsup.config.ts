import { copyFileSync, mkdirSync } from "node:fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
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
