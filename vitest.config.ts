import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The demo imports the package by name. Point both entries at source.
    // Exact matches, so the root alias does not swallow the subpath.
    alias: [
      {
        find: /^use-wasm-state$/,
        replacement: fileURLToPath(new URL("./src/index.ts", import.meta.url)),
      },
      {
        find: /^use-wasm-state\/datagrid$/,
        replacement: fileURLToPath(new URL("./src/datagrid/index.ts", import.meta.url)),
      },
    ],
  },
  test: {
    // Default to node. DOM tests opt in with `// @vitest-environment jsdom`.
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    typecheck: {
      enabled: true,
      include: ["test/**/*.test-d.ts"],
      tsconfig: "./tsconfig.json",
    },
  },
});
