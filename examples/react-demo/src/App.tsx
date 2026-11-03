import { useCallback, useEffect, useRef, useState } from "react";
import { useTableStats, useWasmTable } from "use-wasm-state";
import { Grid, selectionRange } from "@/components/grid";
import { StatusBar } from "@/components/status-bar";
import { Toolbar } from "@/components/toolbar";
import { useFrameRate } from "@/hooks/use-frame-rate";
import { generateOrders, schema } from "@/lib/orders";

const INITIAL_ROWS = 200_000;
const APPEND_ROWS = 10_000;

export function App() {
  const { status, table, error } = useWasmTable(schema);
  const stats = useTableStats(table);
  const fps = useFrameRate();

  const [selection, setSelection] = useState<{ anchor: number; focus: number } | null>(null);
  const [lastMs, setLastMs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const loaded = useRef(false);

  /** Run a store call and report what it cost. */
  const timed = useCallback(<T,>(run: () => T): T => {
    const started = performance.now();
    const result = run();
    setLastMs(performance.now() - started);
    return result;
  }, []);

  // The initial load. Not initialRows, because the generator is the slow
  // part and the status bar should show the insert on its own.
  useEffect(() => {
    if (!table || loaded.current) return;
    loaded.current = true;

    const columns = generateOrders(INITIAL_ROWS);
    timed(() => table.insertColumns(columns));
  }, [table, timed]);

  const append = () => {
    if (!table) return;
    setBusy(true);
    const columns = generateOrders(APPEND_ROWS, table.totalRows);
    timed(() => table.insertColumns(columns));
    setBusy(false);
  };

  const remove = () => {
    if (!table || !selection) return;
    const { from, to } = selectionRange(selection);
    // Row ids, not offsets: offsets shift when rows go, ids never do.
    const ids = table.view(from, to - from + 1).ids;
    timed(() => table.deleteRows(ids));
    setSelection(null);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Delete" || event.key === "Backspace") {
        if (selection && document.activeElement?.tagName !== "INPUT") {
          event.preventDefault();
          remove();
        }
      }
    };
    globalThis.addEventListener("keydown", onKeyDown);
    return () => globalThis.removeEventListener("keydown", onKeyDown);
  });

  if (status === "error") {
    return (
      <main className="grid min-h-dvh place-items-center p-8">
        <p className="max-w-md text-sm text-destructive" data-testid="error">
          {error.message}
        </p>
      </main>
    );
  }

  const selectedCount = selection
    ? selectionRange(selection).to - selectionRange(selection).from + 1
    : 0;

  return (
    <main className="flex h-dvh flex-col">
      <Toolbar
        selectedCount={selectedCount}
        onAppend={append}
        onDelete={remove}
        busy={busy || status !== "ready"}
      />

      {status === "ready" && stats ? (
        <Grid
          table={table}
          rowCount={stats.rowCount}
          selection={selection}
          onSelectionChange={setSelection}
          onEdit={timed}
        />
      ) : (
        <div className="flex-1" />
      )}

      <StatusBar
        rowCount={stats?.rowCount ?? 0}
        revision={stats?.revision ?? 0}
        fps={fps}
        lastMs={lastMs}
      />
    </main>
  );
}
