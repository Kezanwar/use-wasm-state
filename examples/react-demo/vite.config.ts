import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  // Relative, not "/". The demo deploys to GitHub Pages under a sub-path,
  // where an absolute "/datagrid.wasm" would 404. Relative keeps dev,
  // `vite preview`, Playwright and Pages all working from one setting,
  // and survives the repo being renamed.
  base: "./",
  plugins: [react(), tailwindcss()],
  // Read from the built module, so a size on the page is never typed.
  define: {
    __DATAGRID_WASM_BYTES__: JSON.stringify(
      statSync(fileURLToPath(new URL("../../src/datagrid/datagrid.wasm", import.meta.url))).size
    ),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: { port: 5173 },
  // Vite serves .wasm as `Content-Type: application/wasm`, which is what
  // lets the loader take the WebAssembly.compileStreaming path.
});
