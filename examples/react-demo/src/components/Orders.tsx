import { Profiler, useCallback, useEffect, useRef, useState } from "react";
import {
  useDataGridQuery,
  useDataGridStats,
  type AnyDataGridStore,
  type DataGridQuery,
} from "use-wasm-state/datagrid";
import { Grid, selectionRange } from "@/components/Grid";
import { StatusBar } from "@/components/StatusBar";
import { Toolbar } from "@/components/Toolbar";
import { onRenderCommit } from "@/lib/profile";
import { generateOrders, STATUSES, type orders } from "@/lib/orders";

type Schema = typeof orders.spec;

const INITIAL_ROWS = 200_000;
const APPEND_ROWS = 10_000;

/**
 * Remembered across the Main thread / Worker switch, which remounts this
 * with the other engine. The generator is seeded, so the rows that come
 * back are the rows that left, and the sort and filters go with them.
 */
let carried: DataGridQuery<Schema> = {};

export interface OrdersProps {
  grid: AnyDataGridStore<Schema> | null;
  error: Error | null;
  /** Rows rendered past the edge of the viewport. */
  overscan: number;
}

/**
 * Two hundred thousand orders, scrolled, sorted, filtered and edited.
 *
 * Written once for both modes: it awaits every mutation it makes, which
 * the worker store needs and the sync store does not mind. Nothing here
 * holds row data in React state. The grid renders whatever the current
 * view returns, and the view is whatever the engine's revision says.
 */
export function Orders({ grid, error, overscan }: OrdersProps) {
  const stats = useDataGridStats(grid);
  const query = useDataGridQuery(grid);

  const [selection, setSelection] = useState<{ anchor: number; focus: number } | null>(null);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);
  // Taken on mount, before this grid's own empty query replaces it.
  const [initialQuery] = useState(() => carried);

  /**
   * Run a mutation and show what the engine cost.
   *
   * The number comes from the store, not from a clock around the call: in
   * a worker that would include React re-rendering whatever came back,
   * which is this component's time and not the engine's.
   */
  const timed = useCallback(
    async (run: () => unknown) => {
      await run();
      setLastMs(grid?.lastCallMs ?? null);
    },
    [grid]
  );

  // Not initialRows, because generating the dataset is the slow part and
  // the status bar should show the insert on its own.
  useEffect(() => {
    if (!grid || loaded.current) return;
    loaded.current = true;
    void timed(() => grid.insertColumns(generateOrders(INITIAL_ROWS))).then(() => {
      // After the rows, so a sort has something to sort. Skipped when
      // there is nothing to carry, which saves a round trip.
      const { sort = [], filters = [], search = "" } = initialQuery;
      if (sort.length || filters.length || search) void grid.setQuery(initialQuery);
    });
  }, [grid, timed, initialQuery]);

  useEffect(() => {
    if (query) carried = query;
  }, [query]);

  const append = async () => {
    if (!grid) return;
    setBusy(true);
    await timed(() => grid.insertColumns(generateOrders(APPEND_ROWS, grid.totalRows)));
    setBusy(false);
  };

  const statuses =
    (query?.filters.find((f) => f.column === "status" && f.op === "in")?.value as
      readonly string[] | undefined) ?? STATUSES;

  const setStatuses = (next: readonly string[]) => {
    if (!grid) return;
    // Every chip on is the same as no filter at all, and saying so keeps
    // the engine from scanning for a clause that excludes nothing.
    const filters =
      next.length === STATUSES.length
        ? []
        : ([{ column: "status", op: "in", value: next }] as const);
    void timed(() => grid.setQuery({ ...grid.query, filters: [...filters] }));
    setSelection(null);
  };

  const remove = useCallback(async () => {
    if (!grid || !selection) return;
    const { from, to } = selectionRange(selection);
    // Row ids, not offsets: offsets shift when rows go, ids never do. And
    // readWindow rather than view, because a selection can run past what
    // is on screen and those ids have to be the real ones.
    const { ids } = await grid.readWindow(from, to - from + 1);
    void timed(() => grid.deleteRows(ids));
    setSelection(null);
  }, [grid, selection, timed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (!selection || document.activeElement?.tagName === "INPUT") return;
      event.preventDefault();
      void remove();
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  }, [selection, remove]);

  if (error) {
    return (
      <p className="text-destructive p-4 text-sm" data-testid="grid-error">
        {error.message}
      </p>
    );
  }

  const selected = selection ? selectionRange(selection) : null;

  return (
    <Profiler id="grid" onRender={onRenderCommit}>
      <div className="flex h-[32rem] flex-col overflow-hidden rounded-xl border">
        <Toolbar
          selectedCount={selected ? selected.to - selected.from + 1 : 0}
          search={query?.search ?? ""}
          statuses={statuses}
          onSearch={(text) => {
            if (!grid) return;
            void timed(() => grid.search(text));
            setSelection(null);
          }}
          onToggleStatus={(status) =>
            setStatuses(
              statuses.includes(status)
                ? statuses.filter((s) => s !== status)
                : [...statuses, status]
            )
          }
          onAppend={() => void append()}
          onDelete={() => void remove()}
          busy={busy || !grid}
        />

        {grid && stats ? (
          <Grid
            grid={grid}
            rowCount={stats.rowCount}
            overscan={overscan}
            selection={selection}
            onSelectionChange={setSelection}
            onEdit={(run) => void timed(run)}
            onSort={(run) => {
              void timed(run);
              setSelection(null);
            }}
          />
        ) : (
          <div className="bg-muted/30 flex-1 animate-pulse" />
        )}

        <StatusBar
          rowCount={stats?.rowCount ?? 0}
          revision={stats?.revision ?? 0}
          lastMs={lastMs}
        />
      </div>
    </Profiler>
  );
}
