import { cpSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "@react-router/dev/config";

/**
 * A static site: every route is pre-rendered to its own HTML at build time
 * and hydrates into the client app, so deep links and refreshes work on
 * GitHub Pages with no server. The basename is the repo's Pages sub-path;
 * vite.config.ts takes its base from here.
 */
export default {
  appDirectory: "src",
  buildDirectory: "dist",
  basename: "/use-wasm-state/",
  ssr: false,
  prerender: true,
  // Pre-rendering writes pages under the basename, for a host serving
  // dist/client at "/". Pages serves it at the basename instead, so the
  // pages move up beside assets/.
  buildEnd({ reactRouterConfig }) {
    const client = join(reactRouterConfig.buildDirectory, "client");
    const nested = join(client, reactRouterConfig.basename);
    cpSync(nested, client, { recursive: true });
    rmSync(nested, { recursive: true });
  },
} satisfies Config;
