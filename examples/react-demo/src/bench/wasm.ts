/**
 * The real engine, for the benchmark.
 *
 * The package deliberately has no way to make a grid outside React, and a
 * benchmark needs a fresh engine per sample and a look at its linear
 * memory. So this assembles the same store the sync hook hands out, from
 * the same source the package is built from, one layer down: load the
 * module, wrap it in the sync client, create a grid.
 *
 * Sync only. The worker store is measured through the public hook, which
 * is how anyone would get one.
 */

import type { DataGridSchema, DataGridStore, SchemaSpec } from "use-wasm-state/datagrid";
import { instantiateModule } from "../../../../src/core/wasm/loader";
import type { EngineExports } from "../../../../src/datagrid/abi";
import { createDataGridStore } from "../../../../src/datagrid/store";
import { SyncClient } from "../../../../src/datagrid/sync-client";

export interface WasmGrid<S extends SchemaSpec> {
  store: DataGridStore<S>;
  /** Bytes of linear memory the engine has reserved. */
  linearMemory(): number;
  dispose(): void;
}

/** A private engine with one grid in it. */
export async function createWasmGrid<S extends SchemaSpec>(
  schema: DataGridSchema<S>,
  wasmUrl: string
): Promise<WasmGrid<S>> {
  const instance = await instantiateModule(wasmUrl);
  const exports = instance.exports as unknown as EngineExports;
  const client = new SyncClient(exports);
  const store = createDataGridStore(client, client.createGridSync(schema.columns), schema);
  return {
    store,
    linearMemory: () => exports.memory.buffer.byteLength,
    dispose() {
      store.dispose();
      client.dispose();
    },
  };
}
