/**
 * The creation hooks, one per mode, so the store's type never depends on a
 * string.
 *
 * Given a schema, each is a one-off: a private engine with one grid in it,
 * disposed on unmount. Given a definition, each is the shared grid from the
 * matching provider: created on first use, kept for the provider's life.
 */

import { useMemo, useRef } from "react";
import type { Mode } from "../core/contract";
import { usePrivateState, useSharedState, type StateResult } from "../core/state";
import type { AsyncDataGridStore } from "./async-store";
import { isDataGridDef, recipes, type DataGridDef } from "./define";
import { sameShape, type Row, type SchemaSpec, type DataGridSchema } from "./schema";
import type { DataGridStore } from "./store";

export interface UseWasmDataGridSyncOptions<S extends SchemaSpec> {
  /** Where to fetch datagrid.wasm from. Defaults to the copy beside the bundle. */
  wasmUrl?: string | URL;
  /** Rows to load once, as soon as the grid exists. */
  initialRows?: readonly Row<S>[];
}

export interface UseWasmDataGridAsyncOptions<
  S extends SchemaSpec,
> extends UseWasmDataGridSyncOptions<S> {
  /** Where to fetch datagrid.worker.js from. Defaults to the copy beside the bundle. */
  workerUrl?: string | URL;
}

/**
 * `isReady` carries a literal type per branch so it works as a second
 * discriminant alongside `status`, and still narrows after destructuring.
 * A derived boolean would not.
 */
export type UseWasmDataGridResult<T> =
  | { status: "loading"; isReady: false; grid: null; error: null }
  | { status: "ready"; isReady: true; grid: T; error: null }
  | { status: "error"; isReady: false; grid: null; error: Error };

/**
 * A grid on the main thread. Viewports are read during render; mutations
 * return their results and are visible on the next line.
 *
 *   const { status, grid } = useWasmDataGridSync(schema);
 *   if (status === "ready") grid.insertRows([{ price: 1, status: "new" }]);
 */
export function useWasmDataGridSync<S extends SchemaSpec>(
  def: DataGridDef<S>
): UseWasmDataGridResult<DataGridStore<S>>;
export function useWasmDataGridSync<S extends SchemaSpec>(
  schema: DataGridSchema<S>,
  options?: UseWasmDataGridSyncOptions<S>
): UseWasmDataGridResult<DataGridStore<S>>;
export function useWasmDataGridSync<S extends SchemaSpec>(
  source: DataGridDef<S> | DataGridSchema<S>,
  options: UseWasmDataGridSyncOptions<S> = {}
): UseWasmDataGridResult<DataGridStore<S>> {
  return useDataGrid("sync", source, options);
}

/**
 * A grid in a worker. Reads stay synchronous, because every reply carries
 * the rows on screen; mutations return Promises, because they cross a
 * thread.
 *
 *   const { status, grid } = useWasmDataGridAsync(schema);
 *   if (status === "ready") await grid.sortBy("price", "desc");
 */
export function useWasmDataGridAsync<S extends SchemaSpec>(
  def: DataGridDef<S>
): UseWasmDataGridResult<AsyncDataGridStore<S>>;
export function useWasmDataGridAsync<S extends SchemaSpec>(
  schema: DataGridSchema<S>,
  options?: UseWasmDataGridAsyncOptions<S>
): UseWasmDataGridResult<AsyncDataGridStore<S>>;
export function useWasmDataGridAsync<S extends SchemaSpec>(
  source: DataGridDef<S> | DataGridSchema<S>,
  options: UseWasmDataGridAsyncOptions<S> = {}
): UseWasmDataGridResult<AsyncDataGridStore<S>> {
  return useDataGrid("async", source, options);
}

function useDataGrid<S extends SchemaSpec, T>(
  mode: Mode,
  source: DataGridDef<S> | DataGridSchema<S>,
  options: UseWasmDataGridAsyncOptions<S>
): UseWasmDataGridResult<T> {
  const def = isDataGridDef(source) ? source : null;
  const schema = def ? null : (source as DataGridSchema<S>);

  // A one-off reads its schema and initial rows once, on mount. Changing
  // them afterwards cannot migrate a grid that already holds rows.
  const oneOff = useRef<ReturnType<typeof recipes<S>> | null>(null);
  const firstSchema = useRef(schema);
  if (schema && !oneOff.current) {
    oneOff.current = recipes(schema, options.initialRows);
    firstSchema.current = schema;
  }

  if (process.env.NODE_ENV !== "production") {
    // Only when the shape actually differs. A schema rebuilt inline on
    // every render is a new object but the same grid, and warning about
    // that would train people to ignore the warning.
    const first = firstSchema.current;
    if (schema && first && first !== schema && !sameShape(first, schema)) {
      console.warn(
        "use-wasm-state: a grid's schema changed after mount and was ignored. " +
          "A grid cannot be migrated in place; remount with a `key` instead."
      );
    }
  }

  // An inline `new URL(...)` is a different object every render but the
  // same address. Depending on the string means it does not tear the
  // engine down and build it again on each one.
  const wasmUrl = options.wasmUrl === undefined ? undefined : String(options.wasmUrl);
  const workerUrl = options.workerUrl === undefined ? undefined : String(options.workerUrl);

  const shared = useSharedState<DataGridStore<S>>(mode, def);
  const owned = usePrivateState<DataGridStore<S>>(mode, def ? null : oneOff.current, {
    wasmUrl,
    workerUrl,
  });

  const state = def ? shared : owned;
  return useMemo(() => toResult<T>(state), [state]);
}

function toResult<T>(state: StateResult<unknown>): UseWasmDataGridResult<T> {
  switch (state.status) {
    case "loading":
      return LOADING;
    case "ready":
      return { status: "ready", isReady: true, grid: state.value as T, error: null };
    case "error":
      return { status: "error", isReady: false, grid: null, error: state.error };
  }
}

const LOADING = { status: "loading", isReady: false, grid: null, error: null } as const;
