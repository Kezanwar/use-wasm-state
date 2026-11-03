/**
 * Creating an engine: one wasm instance, holding any number of tables.
 *
 * One instance means one linear memory, which is why shared tables (build
 * step 9) all live in the same engine. Two engines would mean two copies of
 * every row.
 */

import type { EngineExports } from "../engine/abi";
import { SyncClient } from "../engine/sync-client";
import { disposedError } from "../engine/errors";
import { instantiateModule } from "../internal/wasm/loader";
import { createTableStore, type TableStore } from "./table-store";
import type { SchemaSpec, TableSchema } from "./schema";

export interface EngineOptions {
  /**
   * Where the engine runs.
   *
   * "sync" is the main thread, reading viewports during render. "worker"
   * arrives in build step 8 and throws until then.
   */
  mode?: "sync" | "worker";
  /**
   * Where to fetch engine.wasm from.
   *
   * Defaults to the copy shipped next to the bundle, resolved with
   * `new URL("./engine.wasm", import.meta.url)`. Vite and webpack 5 both
   * understand that and keep the streaming compile. Pass this for a CDN,
   * a strict CSP, or a bundler that cannot resolve the asset.
   */
  wasmUrl?: string | URL;
  /** Reuse the compiled module across engines with the same URL. Default: true. */
  cache?: boolean;
}

export interface Engine {
  /** Create a table and return a store for it. */
  createTable<S extends SchemaSpec>(schema: TableSchema<S>): TableStore<S>;
  /** Drop the engine. Stores made from it stop working. */
  dispose(): void;
}

/**
 * The default location of the engine, next to this module in the bundle.
 *
 * Written as a function so the `import.meta.url` reference is evaluated at
 * call time rather than at import time: a CJS consumer whose bundler cannot
 * resolve it should pass `wasmUrl` instead, and would otherwise be unable
 * to even import the package.
 */
function defaultWasmUrl(): string {
  return new URL("./engine.wasm", import.meta.url).href;
}

export async function createEngine(options: EngineOptions = {}): Promise<Engine> {
  const { mode = "sync", wasmUrl, cache = true } = options;

  if (mode === "worker") {
    throw new Error(
      'use-wasm-state: mode "worker" is not implemented yet. It arrives in build step 8; ' +
        'use mode "sync" until then.'
    );
  }

  const url = wasmUrl ? String(wasmUrl) : defaultWasmUrl();
  const instance = await instantiateModule(url, { cache });
  const client = new SyncClient(instance.exports as unknown as EngineExports);

  const stores = new Set<TableStore<SchemaSpec>>();
  let disposed = false;

  return {
    createTable<S extends SchemaSpec>(schema: TableSchema<S>): TableStore<S> {
      if (disposed) throw disposedError("createTable", "engine");
      const handle = client.createTableSync(schema.columns);
      const store = createTableStore(client, handle, schema);
      stores.add(store as unknown as TableStore<SchemaSpec>);
      return store;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      // Drop the tables first, so each one releases its handle while the
      // client still works. Disposing a store twice is a no-op, so a
      // caller that already dropped one is fine.
      for (const store of stores) store.dispose();
      stores.clear();
      client.dispose();
    },
  };
}
