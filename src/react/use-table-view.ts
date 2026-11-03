import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { SchemaSpec } from "../store/schema";
import type { TableQuery } from "../store/query";
import type { TableReader, TableView } from "../store/table-store";

/** No table yet, so nothing to watch. */
const NO_VERSION = -1;

/**
 * Subscribe to a table's version.
 *
 * The snapshot is a number, not a view. useSyncExternalStore compares
 * snapshots by identity and warns if one is not stable, and a view is an
 * object the store can only cache one of; two components watching
 * different windows would evict each other and each see a fresh object
 * every read.
 *
 * The version rather than the revision, because in worker mode a window
 * can arrive without the data having changed, and a hook keyed on the
 * revision would never re-render to look at it.
 */
function useVersion(table: TableReader<SchemaSpec> | null) {
  const subscribe = useCallback(
    (onChange: () => void) => (table ? table.subscribe(onChange) : () => {}),
    [table]
  );
  const getSnapshot = useCallback(() => (table ? table.version : NO_VERSION), [table]);
  // The server has no engine, so it sees what the client sees before the
  // first effect runs and hydration has nothing to reconcile.
  const getServerSnapshot = useCallback(() => NO_VERSION, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Subscribe to one window of a table.
 *
 * The component re-renders when the table's revision moves, and reads only
 * the rows it is showing. That is the whole reactivity story: Go owns the
 * data and a counter, React owns the scroll position.
 *
 *   const view = useTableView(table, start, 50);
 *   view?.rows().map((row, i) => <Row key={view.ids[i]} {...row} />)
 *
 * `table` may be null while the engine is loading, in which case the result
 * is null.
 */
export function useTableView<S extends SchemaSpec>(
  table: TableReader<S> | null,
  start: number,
  count: number
): TableView<S> | null {
  const version = useVersion(table as TableReader<SchemaSpec> | null);

  // Tell the store this window is on screen. In worker mode that is what
  // makes every reply carry its rows, so scrolling costs no extra round
  // trip; the sync store has nothing to do and says so.
  useEffect(() => {
    if (!table) return;
    return table.watch(start, count);
  }, [table, start, count]);

  // Built here rather than inside getSnapshot so the store's single-window
  // cache stays an optimisation. Two components on different windows each
  // keep their own memo; neither can invalidate the other's.
  return useMemo(() => (table ? table.view(start, count) : null), [table, version, start, count]);
}

export interface TableStats {
  /** Bumped by every mutation that changed something. */
  revision: number;
  /** Live rows. */
  rowCount: number;
  /** Rows ever inserted, tombstones included. */
  totalRows: number;
}

/**
 * Subscribe to a table's size and revision, without reading any rows.
 *
 * For a status bar or a header, which have to update when the table
 * changes but do not care what is in it. Null while the table is loading.
 */
export function useTableStats<S extends SchemaSpec>(
  table: TableReader<S> | null
): TableStats | null {
  const version = useVersion(table as TableReader<SchemaSpec> | null);

  return useMemo(() => {
    if (!table) return null;
    return {
      revision: table.revision,
      rowCount: table.rowCount,
      totalRows: table.totalRows,
    };
  }, [table, version]);
}

/**
 * Subscribe to a table's query.
 *
 * For a toolbar that has to show which column is sorted and what is
 * filtered, without reading any rows. Null while the table is loading.
 */
export function useTableQuery<S extends SchemaSpec>(
  table: TableReader<S> | null
): Required<TableQuery<S>> | null {
  const version = useVersion(table as TableReader<SchemaSpec> | null);

  // Keyed on the version like everything else, so a toolbar updates on the
  // same signal the rows do.
  return useMemo(() => (table ? table.query : null), [table, version]);
}
