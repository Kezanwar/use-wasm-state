import { useEffect, useRef, useState } from "react";
import { createEngine, type Engine } from "../store/create-engine";
import { notImplementedError } from "../engine/errors";
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

  // An inline `new URL(...)` is a different object every render but the
  // same address. Depending on the string means it does not tear the
  // engine down and build it again on each one.
  const wasmUrlKey = wasmUrl === undefined ? undefined : String(wasmUrl);

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
    // An option that type-checks but is not built yet is a failure of this
    // hook, not of the render. Reporting it through status means a consumer
    // handles it the same way it handles a missing .wasm, instead of
    // needing an error boundary for a typo.
    const unsupported =
      shared !== undefined
        ? notImplementedError("options.shared", "build step 9")
        : mode === "worker"
          ? notImplementedError('mode "worker"', "build step 8")
          : null;

    if (unsupported) {
      setState({ status: "error", isReady: false, table: null, error: unsupported });
      return;
    }

    // StrictMode mounts, unmounts and mounts again. The first engine is
    // still loading when the cleanup runs, so it is disposed as soon as it
    // arrives rather than left behind holding a wasm instance.
    let cancelled = false;
    let engine: Engine | null = null;

    setState(LOADING);

    (async () => {
      try {
        const created = await createEngine({ wasmUrl: wasmUrlKey, mode: "sync" });
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
  }, [wasmUrlKey, shared, mode]);

  return state;
}
