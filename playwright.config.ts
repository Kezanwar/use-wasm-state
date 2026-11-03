import { defineConfig, devices } from "@playwright/test";

const PORT = 5174;
const SUBPATH_PORT = 4178;
const baseURL = `http://localhost:${PORT}`;

/**
 * The browser is the only place the real thing runs: a module Worker from a
 * Blob URL, a WebAssembly.Module structured-cloned across the thread
 * boundary, and a 200k-row grid scrolling at frame rate. jsdom can do none
 * of that.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "list" : [["list"]],
  use: { baseURL, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      // The demo resolves `use-wasm-state` through the workspace link to
      // dist/, so the package has to be built first.
      command: `pnpm build && pnpm --filter use-wasm-state-demo exec vite --port ${PORT} --strictPort`,
      url: baseURL,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "pipe",
    },
    {
      // A production build served from a sub-directory, the way GitHub
      // Pages does. See e2e/subpath.spec.ts.
      command: `pnpm --filter use-wasm-state-demo build && node scripts/serve-subpath.mjs`,
      url: `http://localhost:${SUBPATH_PORT}/use-wasm-state/`,
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
      stdout: "pipe",
    },
  ],
});
