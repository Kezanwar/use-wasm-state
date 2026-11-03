import { useEffect, useRef, useState } from "react";
import { createEngine, type Engine } from "../store/create-engine";
import { sameShape, type Row, type SchemaSpec, type TableSchema } from "../store/schema";
import type { TableStore } from "../store/table-store";

export interface UseWasmTableOptions<S extends SchemaSpec> {
  /** Where to fetch engine.wasm from. See EngineOptions.wasmUrl. */
  wasmUrl?: string | URL;
  /** Rows to load once, as soon as the table exists. */
  initialRows?: readonly Row<S>[];
  /**
   * Share one table between every caller using the same key.
   *
   * Build step 9. Throws until then.
   */
  shared?: string;
  /**
   * Run the engine in a Web Worker. Build step 8. Throws until then.
   */
  mode?: "sync" | "worker";
}

/**
 * `isReady` carries a literal type per branch so it works as a second
 * discriminant alongside `status`, and still narrows after destructuring.
 * A derived boolean would not.
 */
export type UseWasmTableResult<S extends SchemaSpec> =
  | { status: "loading"; isReady: false; table: null; error: null }
  | { status: "ready"; isReady: true; table: TableStore<S>; error: null }
  | { status: "error"; isReady: false; table: null; error: Error };

const LOADING = { status: "loading", isReady: false, table: null, error: null } as const;

/**
 * Load an engine, create one table in it, and hand back its store.
 *
 * A one-off: this hook owns a private engine with exactly one table, and
 * disposes both on unmount. Sharing a table between components is
 * `options.shared`, which arrives in build step 9.
 *
 *   const schema = defineSchema({ price: "f64", status: "string" });
 *   const { status, table } = useWasmTable(schema);
 *   if (status === "ready") table.insertRows([{ price: 1, status: "new" }]);
 *
 * The schema is read once, on mount. Changing it afterwards cannot migrate
 * a table that already holds rows, so it is ignored (and warned about in
 * development).
 */
export function useWasmTable<S extends SchemaSpec>(
  schema: TableSchema<S>,
  options: UseWasmTableOptions<S> = {}
): UseWasmTableResult<S> {
  const { wasmUrl, initialRows, shared, mode } = options;

  const [state, setState] = useState<UseWasmTableResult<S>>(LOADING);

  // Read once, on mount. Keeping them in a ref means a new options object
  // every render does not tear the table down and build it again.
  const initialRef = useRef(initialRows);
  const schemaRef = useRef(schema);

  if (process.env.NODE_ENV !== "production") {
    // Only complain when the shape actually differs. A schema rebuilt
    // inline on every render is a new object but the same table, and
    // warning about that would train people to ignore the warning.
    if (schemaRef.current !== schema && !sameShape(schemaRef.current, schema)) {
      console.warn(
        "use-wasm-state: useWasmTable's schema changed after mount and was ignored. " +
          "A table cannot be migrated in place; remount with a `key` instead."
      );
    }
  }

  useEffect(() => {
    if (shared !== undefined) {
      throw new Error(
        "use-wasm-state: options.shared is not implemented yet. It arrives in build step 9."
      );
    }
    if (mode === "worker") {
      throw new Error(
        'use-wasm-state: mode "worker" is not implemented yet. It arrives in build step 8.'
      );
    }

    // StrictMode mounts, unmounts and mounts again. The first engine is
    // still loading when the cleanup runs, so it is disposed as soon as it
    // arrives rather than left behind holding a wasm instance.
    let cancelled = false;
    let engine: Engine | null = null;

    setState(LOADING);

    (async () => {
      try {
        const created = await createEngine({ wasmUrl, mode: "sync" });
        if (cancelled) {
          created.dispose();
          return;
        }
        engine = created;

        const table = created.createTable(schemaRef.current);
        // Loaded here rather than in a second effect, so a double mount
        // cannot insert them twice: this table was created a line ago and
        // is thrown away whole if the mount is cancelled.
        if (initialRef.current?.length) table.insertRows(initialRef.current);

        if (cancelled) {
          created.dispose();
          engine = null;
          return;
        }
        setState({ status: "ready", isReady: true, table, error: null });
      } catch (err) {
        if (cancelled) return;
        setState({
          status: "error",
          isReady: false,
          table: null,
          error: err instanceof Error ? err : new Error(String(err)),
        });
      }
    })();

    return () => {
      cancelled = true;
      engine?.dispose();
      engine = null;
    };
  }, [wasmUrl, shared, mode]);

  return state;
}
