import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { SchemaSpec } from "./schema";
import type { DataGridQuery } from "./query";
import type { DataGridReader, DataGridView } from "./store";

/** No grid yet, so nothing to watch. */
const NO_VERSION = -1;

/**
 * Subscribe to a grid's version.
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
function useVersion(grid: DataGridReader<SchemaSpec> | null) {
  const subscribe = useCallback(
    (onChange: () => void) => (grid ? grid.subscribe(onChange) : () => {}),
    [grid]
  );
  const getSnapshot = useCallback(() => (grid ? grid.version : NO_VERSION), [grid]);
  // The server has no engine, so it sees what the client sees before the
  // first effect runs and hydration has nothing to reconcile.
  const getServerSnapshot = useCallback(() => NO_VERSION, []);

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Subscribe to one window of a grid.
 *
 * The component re-renders when the grid's revision moves, and reads only
 * the rows it is showing. That is the whole reactivity story: Go owns the
 * data and a counter, React owns the scroll position.
 *
 *   const view = useDataGridView(grid, start, 50);
 *   view?.rows().map((row, i) => <Row key={view.ids[i]} {...row} />)
 *
 * `grid` may be null while it loads, in which case the result is null.
 */
export function useDataGridView<S extends SchemaSpec>(
  grid: DataGridReader<S> | null,
  start: number,
  count: number
): DataGridView<S> | null {
  const version = useVersion(grid as DataGridReader<SchemaSpec> | null);

  // Tell the store this window is on screen. In worker mode that is what
  // makes every reply carry its rows, so scrolling costs no extra round
  // trip; the sync store has nothing to do and says so.
  useEffect(() => {
    if (!grid) return;
    return grid.watch(start, count);
  }, [grid, start, count]);

  // Built here rather than inside getSnapshot so the store's single-window
  // cache stays an optimisation. Two components on different windows each
  // keep their own memo; neither can invalidate the other's.
  return useMemo(() => (grid ? grid.view(start, count) : null), [grid, version, start, count]);
}

export interface DataGridStats {
  /** Bumped by every mutation that changed something. */
  revision: number;
  /** Live rows. */
  rowCount: number;
  /** Rows ever inserted, tombstones included. */
  totalRows: number;
}

/**
 * Subscribe to a grid's size and revision, without reading any rows.
 *
 * For a status bar or a header, which have to update when the grid
 * changes but do not care what is in it. Null while the grid is loading.
 */
export function useDataGridStats<S extends SchemaSpec>(
  grid: DataGridReader<S> | null
): DataGridStats | null {
  const version = useVersion(grid as DataGridReader<SchemaSpec> | null);

  return useMemo(() => {
    if (!grid) return null;
    return {
      revision: grid.revision,
      rowCount: grid.rowCount,
      totalRows: grid.totalRows,
    };
  }, [grid, version]);
}

/**
 * Subscribe to a grid's query.
 *
 * For a toolbar that has to show which column is sorted and what is
 * filtered, without reading any rows. Null while the grid is loading.
 */
export function useDataGridQuery<S extends SchemaSpec>(
  grid: DataGridReader<S> | null
): Required<DataGridQuery<S>> | null {
  const version = useVersion(grid as DataGridReader<SchemaSpec> | null);

  // Keyed on the version like everything else, so a toolbar updates on the
  // same signal the rows do.
  return useMemo(() => (grid ? grid.query : null), [grid, version]);
}
