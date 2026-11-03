import { useCallback, useSyncExternalStore } from "react";
import type { SchemaSpec } from "../store/schema";
import type { TableStore, TableView } from "../store/table-store";

/**
 * Subscribe to one window of a table.
 *
 * The component re-renders when the table's revision moves, and reads only
 * the rows it is showing. That is the whole reactivity story: Go owns the
 * data and a counter, React owns the scroll position.
 *
 *   const view = useTableView(table, scrollStart, 50);
 *   view?.rows().map((row, i) => <Row key={view.ids[i]} {...row} />)
 *
 * `table` may be null while the engine is still loading, in which case the
 * result is null.
 *
 * The store returns the identical view object for the same (revision,
 * start, count), which is what lets this be a useSyncExternalStore
 * snapshot: a fresh object every call would re-render forever.
 */
export function useTableView<S extends SchemaSpec>(
  table: TableStore<S> | null,
  start: number,
  count: number
): TableView<S> | null {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!table) return () => {};
      return table.subscribe(onChange);
    },
    [table]
  );

  const getSnapshot = useCallback(() => {
    if (!table) return null;
    return table.view(start, count);
  }, [table, start, count]);

  // On the server there is no engine and no table, so the snapshot is the
  // same null the client starts from. Rendering anything else would
  // hydrate into a mismatch.
  const getServerSnapshot = useCallback(() => null, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
