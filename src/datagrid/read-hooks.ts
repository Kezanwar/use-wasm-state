import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
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

/**
 * Which rows to read: from `overscan` above the top row to `overscan` below
 * the last visible one, with the start snapped down to a multiple of
 * `block`. Internal; exported for its tests.
 */
export function windowFor({
  top,
  visible,
  rowCount,
  overscan,
  block,
}: {
  top: number;
  visible: number;
  rowCount: number;
  overscan: number;
  block: number;
}): { start: number; count: number } {
  // One block more than the visible rows and overscan need, for the row
  // that is only partly in view and for the snap.
  const span = (Math.ceil((visible + overscan * 2) / block) + 1) * block;
  const snapped = Math.floor(Math.max(0, top - overscan) / block) * block;
  // Past the end, as when a filter shrinks the grid under a deep scroll,
  // the window ends at the last row rather than holding one or none.
  const start = Math.max(0, Math.min(snapped, rowCount - span));
  return { start, count: Math.max(0, Math.min(rowCount - start, span)) };
}

/**
 * Virtualise a grid: the rows to draw for wherever its scroll container
 * is, and where to draw them.
 *
 *   const { ref, totalHeight, offsetY, view, scrollToRow } =
 *     useDataGridWindow(grid, { rowHeight: 32 });
 *
 *   <div ref={ref} style={{ overflow: "auto" }}>
 *     <div style={{ height: totalHeight }}>
 *       <div style={{ transform: `translateY(${offsetY}px)` }}>
 *         {view?.rows().map((row, i) => <Row key={i} {...row} />)}
 *
 * Rows are a fixed height. `offsetY` comes from the view's own start, so
 * rows that are a round trip behind are still drawn where they belong.
 * `grid` may be null while it loads.
 */
export function useDataGridWindow<S extends SchemaSpec>(
  grid: DataGridReader<S> | null,
  options: {
    /** Every row's height, in pixels. */
    rowHeight: number;
    /** Rows drawn past each edge. Defaults to 4, or 16 in a worker. */
    overscan?: number;
  }
): {
  /** Attach to the scroll container. */
  ref: (element: HTMLElement | null) => void;
  /** Height of every live row, so the scrollbar is the right size. */
  totalHeight: number;
  /** How far down to draw `view`. */
  offsetY: number;
  /** The rows to draw, or null while the grid loads. */
  view: DataGridView<S> | null;
  /** Scroll just far enough that a row, by position in the order, is in view. */
  scrollToRow(row: number): void;
} {
  const { rowHeight } = options;
  // A callback ref, so the listeners below attach whenever the container
  // does, including after a loading state that rendered none.
  const [element, ref] = useState<HTMLElement | null>(null);
  // The row at the top, not the pixel offset, so a scroll within a row
  // changes nothing and renders nothing.
  const [top, setTop] = useState(0);
  const [height, setHeight] = useState(0);

  useEffect(() => {
    if (!element) return;
    // Read from the element on every event, so a fast scroll never draws a
    // window it has already left; re-measured on resize, since a grid
    // fills whatever space it is given.
    //
    // Only a changed value is set. React's bail-out on an equal one can
    // still call the component first, and a scroll fires every frame.
    let shownTop = -1;
    let shownHeight = -1;
    const onScroll = () => {
      const next = Math.floor(element.scrollTop / rowHeight);
      if (next !== shownTop) setTop((shownTop = next));
    };
    const measure = () => {
      if (element.clientHeight !== shownHeight) setHeight((shownHeight = element.clientHeight));
      onScroll();
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", onScroll);
    };
  }, [element, rowHeight]);

  const version = useVersion(grid as DataGridReader<SchemaSpec> | null);
  const rowCount = useMemo(() => (grid ? grid.rowCount : 0), [grid, version]);

  // On this thread a read costs microseconds, so the window follows the
  // scroll exactly. In a worker every new window is a round trip, so it
  // moves in blocks of the overscan: a drag asks for the same rows for a
  // while instead of new ones every frame.
  const async = grid?.mode === "async";
  const overscan = options.overscan ?? (async ? 16 : 4);
  const { start, count } = windowFor({
    top,
    visible: Math.max(1, Math.ceil(height / rowHeight)),
    rowCount,
    overscan,
    block: async ? Math.max(1, overscan) : 1,
  });

  const view = useDataGridView(grid, start, count);

  const scrollToRow = useCallback(
    (row: number) => {
      if (!element) return;
      const top = row * rowHeight;
      const bottom = top + rowHeight;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (bottom > element.scrollTop + element.clientHeight) {
        element.scrollTop = bottom - element.clientHeight;
      }
    },
    [element, rowHeight]
  );

  return {
    ref,
    totalHeight: rowCount * rowHeight,
    offsetY: (view?.start ?? start) * rowHeight,
    view,
    scrollToRow,
  };
}
