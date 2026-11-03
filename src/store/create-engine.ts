/**
 * Creating an engine: one wasm instance, holding any number of tables.
 *
 * One instance means one linear memory, which is why shared tables (build
 * step 9) all live in the same engine. Two engines would mean two copies of
 * every row.
 */

import type { EngineExports } from "../engine/abi";
import { SyncClient } from "../engine/sync-client";
import { WorkerClient } from "../engine/worker-client";
import { disposedError } from "../engine/errors";
import { instantiateModule } from "../internal/wasm/loader";
import { createTableStore, type TableStore } from "./table-store";
import { createAsyncTableStore, type AsyncTableStore } from "./async-table-store";
import type { SchemaSpec, TableSchema } from "./schema";

export interface EngineOptions {
  /**
   * Where the engine runs.
   *
   * "sync" is the main thread: a viewport is read during render and a
   * mutation is visible on the next line. "worker" moves the engine off
   * the main thread, which makes mutations async and makes a long sort
   * something the page can scroll through.
   */
  mode?: Mode;
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
  /**
   * Where to fetch the worker bundle from, in worker mode.
   *
   * Defaults to the copy shipped beside the package, resolved the same way
   * engine.wasm is. Pass it where a CSP names an explicit worker-src, or
   * where a bundler cannot emit the asset.
   */
  workerUrl?: string | URL;
}

export type Mode = "sync" | "worker";

/** The store a given mode hands back. */
export type StoreFor<M extends Mode, S extends SchemaSpec> = M extends "worker"
  ? AsyncTableStore<S>
  : TableStore<S>;

export interface Engine<M extends Mode = Mode> {
  readonly mode: M;
  /** Create a table and return a store for it. */
  createTable<S extends SchemaSpec>(schema: TableSchema<S>): StoreFor<M, S>;
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

export async function createEngine<M extends Mode = "sync">(
  options: EngineOptions & { mode?: M } = {}
): Promise<Engine<M>> {
  const { mode = "sync" as M, wasmUrl, workerUrl, cache = true } = options;
  const url = wasmUrl ? String(wasmUrl) : defaultWasmUrl();

  return (
    mode === "worker"
      ? await workerEngine(url, cache, workerUrl === undefined ? undefined : String(workerUrl))
      : await syncEngine(url, cache)
  ) as Engine<M>;
}

async function syncEngine(url: string, cache: boolean): Promise<Engine<"sync">> {
  const instance = await instantiateModule(url, { cache });
  const client = new SyncClient(instance.exports as unknown as EngineExports);

  const stores = new Set<TableStore<SchemaSpec>>();
  let disposed = false;

  return {
    mode: "sync",

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
      // client still works. Disposing a store twice is a no-op.
      for (const store of stores) store.dispose();
      stores.clear();
      client.dispose();
    },
  };
}

async function workerEngine(
  url: string,
  cache: boolean,
  workerUrl: string | undefined
): Promise<Engine<"worker">> {
  const client = new WorkerClient({ wasmUrl: url, cache, workerUrl });
  await client.ready();

  const stores = new Set<AsyncTableStore<SchemaSpec>>();
  let disposed = false;

  return {
    mode: "worker",

    createTable<S extends SchemaSpec>(schema: TableSchema<S>): AsyncTableStore<S> {
      if (disposed) throw disposedError("createTable", "engine");
      // Synchronous in both modes: the handle arrives a round trip later
      // and the store waits on it, so a component is written the same way
      // whichever mode it was handed.
      const store = createAsyncTableStore(client, client.createTable(schema.columns), schema);
      stores.add(store as unknown as AsyncTableStore<SchemaSpec>);
      return store;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const store of stores) store.dispose();
      stores.clear();
      client.dispose();
    },
  };
}
