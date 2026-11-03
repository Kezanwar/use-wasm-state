/**
 * The datagrid's engine: one wasm instance, holding any number of grids.
 *
 * One instance is one linear memory, which is why grids under one provider
 * share an engine and a one-off hook gets a private one. Two loaders, one
 * per mode, and the pattern object a provider uses to call them.
 *
 * Internal.
 */

import type { EngineUrls, Pattern } from "../core/contract";
import { registerPattern } from "../core/patterns";
import { disposedError } from "../core/errors";
import { instantiateModule } from "../core/wasm/loader";
import type { EngineExports } from "./abi";
import { createAsyncDataGridStore, type AsyncDataGridStore } from "./async-store";
import type { SchemaSpec, DataGridSchema } from "./schema";
import { createDataGridStore, type DataGridStore } from "./store";
import { SyncClient } from "./sync-client";
import { WorkerClient } from "./worker-client";

export interface SyncGridEngine {
  createGrid<S extends SchemaSpec>(schema: DataGridSchema<S>): DataGridStore<S>;
  /** Drop the engine. Grids made from it stop working. */
  dispose(): void;
}

export interface AsyncGridEngine {
  /**
   * Synchronous, like the sync engine's: the handle arrives a round trip
   * later and the store waits on it, so a grid is created the same way
   * whichever engine made it.
   */
  createGrid<S extends SchemaSpec>(schema: DataGridSchema<S>): AsyncDataGridStore<S>;
  dispose(): void;
}

/**
 * The engine beside this module in the bundle.
 *
 * A function, so `import.meta.url` is read when an engine is loaded rather
 * than when the package is imported: a CJS consumer whose bundler cannot
 * resolve it passes `wasmUrl` instead, and must still be able to import.
 */
function defaultWasmUrl(): string {
  return new URL("./datagrid.wasm", import.meta.url).href;
}

export async function loadSyncEngine({ wasmUrl }: EngineUrls = {}): Promise<SyncGridEngine> {
  const instance = await instantiateModule(wasmUrl ?? defaultWasmUrl());
  const client = new SyncClient(instance.exports as unknown as EngineExports);
  const grids = new Set<{ dispose(): void }>();
  let disposed = false;

  return {
    createGrid(schema) {
      if (disposed) throw disposedError("createGrid", "engine");
      const store = createDataGridStore(client, client.createGridSync(schema.columns), schema);
      grids.add(store);
      return store;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      // Each grid releases its handle while the client still works.
      // Disposing a store twice is a no-op.
      for (const grid of grids) grid.dispose();
      grids.clear();
      client.dispose();
    },
  };
}

export async function loadAsyncEngine({
  wasmUrl,
  workerUrl,
}: EngineUrls = {}): Promise<AsyncGridEngine> {
  const client = new WorkerClient({ wasmUrl: wasmUrl ?? defaultWasmUrl(), workerUrl });
  await client.ready();
  const grids = new Set<{ dispose(): void }>();
  let disposed = false;

  return {
    createGrid(schema) {
      if (disposed) throw disposedError("createGrid", "engine");
      const store = createAsyncDataGridStore(client, client.createGrid(schema.columns), schema);
      grids.add(store);
      return store;
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      for (const grid of grids) grid.dispose();
      grids.clear();
      client.dispose();
    },
  };
}

/** What a provider needs to hold datagrids. */
export const datagrid: Pattern<SyncGridEngine, AsyncGridEngine> = {
  name: "datagrid",
  loadSync: loadSyncEngine,
  loadAsync: loadAsyncEngine,
};

// So a provider can tell `urls={{ datagrid: … }}` from a typo of it.
registerPattern(datagrid.name);
