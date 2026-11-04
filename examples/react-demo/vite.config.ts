import { statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import router from "./react-router.config";

export default defineConfig({
  // The router's basename, in dev too, so a path that works locally works
  // deployed.
  base: router.basename,
  plugins: [tailwindcss(), reactRouter()],
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
