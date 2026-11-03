import { Profiler, useCallback, useEffect, useRef, useState } from "react";
import { useTableQuery, useTableStats, useWasmTable, type TableQuery } from "use-wasm-state";
import { Grid, selectionRange, type AnyTable } from "@/components/Grid";
import { StatusBar } from "@/components/StatusBar";
import { Toolbar } from "@/components/Toolbar";
import { onRenderCommit } from "@/lib/profile";
import { generateOrders, schema, STATUSES } from "@/lib/orders";

const INITIAL_ROWS = 200_000;
const APPEND_ROWS = 10_000;

/**
 * A worker answers a window a round trip later, so it reads further ahead.
 * Not much further: every extra row is one more to decode and render on
 * each reply, and past a point that costs more than the round trip.
 */
const OVERSCAN = { sync: 8, worker: 16 } as const;

type Mode = "sync" | "worker";

/**
 * Two hundred thousand orders, scrolled, sorted, filtered and edited.
 *
 * Nothing here holds row data in React state. The grid renders whatever
 * the current view returns, and the view is whatever the engine's revision
 * says it is.
 */
export function GridExample() {
  const [mode, setMode] = useState<Mode>("sync");
  // Survives the remount below, so switching modes reloads the same rows
  // into the other engine and leaves the sort and filters where they were.
  const carried = useRef<TableQuery<typeof schema.spec>>({});

  // Remounted on a mode change, so each mode gets a clean engine and the
  // one it replaces is disposed. The generator is seeded, so the data that
  // comes back is the data that left.
  return (
    <Surface
      key={mode}
      mode={mode}
      onMode={setMode}
      initialQuery={carried.current}
      onQuery={(query) => (carried.current = query)}
    />
  );
}

function Surface({
  mode,
  onMode,
  initialQuery,
  onQuery,
}: {
  mode: Mode;
  onMode: (mode: Mode) => void;
  initialQuery: TableQuery<typeof schema.spec>;
  onQuery: (query: TableQuery<typeof schema.spec>) => void;
}) {
  const { status, table, error } = useWasmTable(schema, { mode });
  const stats = useTableStats(table);
  const query = useTableQuery(table);

  const [selection, setSelection] = useState<{ anchor: number; focus: number } | null>(null);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);

  /**
   * Run a store call and show what the engine cost.
   *
   * The number comes from the store, not from a clock around the call: in
   * worker mode that would include React re-rendering whatever came back,
   * which is this component's time and not the engine's.
   */
  const timed = useCallback(
    <T,>(run: () => T): T => {
      const result = run();
      const report = () => setLastMs(table?.lastCallMs ?? null);
      if (result instanceof Promise) void result.finally(report);
      else report();
      return result;
    },
    [table]
  );

  // Not initialRows, because generating the dataset is the slow part and
  // the status bar should show the insert on its own.
  useEffect(() => {
    if (!table || loaded.current) return;
    loaded.current = true;
    const columns = generateOrders(INITIAL_ROWS);
    void Promise.resolve(timed(() => table.insertColumns(columns))).then(() => {
      // Re-applied after the rows, so a sort has something to sort. An
      // empty carried query is skipped rather than sent, to save a round
      // trip that would change nothing.
      const carries =
        (initialQuery.sort?.length ?? 0) > 0 ||
        (initialQuery.filters?.length ?? 0) > 0 ||
        (initialQuery.search ?? "") !== "";
      if (carries) void table.setQuery(initialQuery);
    });
  }, [table, timed, initialQuery]);

  // Remembered for the other mode, outside this component's lifetime.
  useEffect(() => {
    if (query) onQuery(query);
  }, [query, onQuery]);

  const append = () => {
    if (!table) return;
    setBusy(true);
    const columns = generateOrders(APPEND_ROWS, table.totalRows);
    void Promise.resolve(timed(() => table.insertColumns(columns))).finally(() => setBusy(false));
  };

  const statuses =
    (query?.filters.find((f) => f.column === "status" && f.op === "in")?.value as
      readonly string[] | undefined) ?? STATUSES;

  const setStatuses = (next: readonly string[]) => {
    if (!table) return;
    // Every chip on is the same as no filter at all, and saying so keeps
    // the engine from scanning for a clause that excludes nothing.
    const filters =
      next.length === STATUSES.length
        ? []
        : ([{ column: "status", op: "in", value: next }] as const);
    timed(() => table.setQuery({ ...table.query, filters: [...filters] }));
    setSelection(null);
  };

  const remove = useCallback(async () => {
    if (!table || !selection) return;
    const { from, to } = selectionRange(selection);
    // Row ids, not offsets: offsets shift when rows go, ids never do. And
    // readWindow rather than view, because a selection can run past what
    // is on screen and those ids have to be the real ones.
    const { ids } = await table.readWindow(from, to - from + 1);
    timed(() => table.deleteRows(ids));
    setSelection(null);
  }, [table, selection, timed]);

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

  if (status === "error") {
    return (
      <p className="text-destructive p-4 text-sm" data-testid="grid-error">
        {error.message}
      </p>
    );
  }

  const selectedCount = selection
    ? selectionRange(selection).to - selectionRange(selection).from + 1
    : 0;

  return (
    <Profiler id="grid" onRender={onRenderCommit}>
      <div className="flex h-[32rem] flex-col overflow-hidden rounded-xl border">
        <Toolbar
          mode={mode}
          onMode={onMode}
          selectedCount={selectedCount}
          search={query?.search ?? ""}
          statuses={statuses}
          onSearch={(text) => {
            if (!table) return;
            timed(() => table.search(text));
            setSelection(null);
          }}
          onToggleStatus={(status) =>
            setStatuses(
              statuses.includes(status)
                ? statuses.filter((s) => s !== status)
                : [...statuses, status]
            )
          }
          onAppend={append}
          onDelete={() => void remove()}
          busy={busy || status !== "ready"}
        />

        {status === "ready" && stats ? (
          <Grid
            table={table as AnyTable}
            rowCount={stats.rowCount}
            overscan={OVERSCAN[mode]}
            selection={selection}
            onSelectionChange={setSelection}
            onEdit={timed}
            onSort={(run) => {
              timed(run);
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
