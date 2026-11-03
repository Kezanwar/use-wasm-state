import { useCallback, useEffect, useRef, useState } from "react";
import { useTableStats, useWasmTable } from "use-wasm-state";
import { Grid, selectionRange } from "@/components/Grid";
import { StatusBar } from "@/components/StatusBar";
import { Toolbar } from "@/components/Toolbar";
import { useFrameRate } from "@/hooks/useFrameRate";
import { generateOrders, schema } from "@/lib/orders";

const INITIAL_ROWS = 200_000;
const APPEND_ROWS = 10_000;

/**
 * Two hundred thousand orders, scrolled and edited in place.
 *
 * Nothing here holds row data in React state. The grid renders whatever
 * the current view returns, and the view is whatever the engine's revision
 * says it is.
 */
export function GridExample() {
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

  // Not initialRows, because generating the dataset is the slow part and
  // the status bar should show the insert on its own.
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

  const remove = useCallback(() => {
    if (!table || !selection) return;
    const { from, to } = selectionRange(selection);
    // Row ids, not offsets: offsets shift when rows go, ids never do.
    const ids = table.view(from, to - from + 1).ids;
    timed(() => table.deleteRows(ids));
    setSelection(null);
  }, [table, selection, timed]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (!selection || document.activeElement?.tagName === "INPUT") return;
      event.preventDefault();
      remove();
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
    <div className="flex h-[32rem] flex-col overflow-hidden rounded-xl border">
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
        <div className="bg-muted/30 flex-1 animate-pulse" />
      )}

      <StatusBar
        rowCount={stats?.rowCount ?? 0}
        revision={stats?.revision ?? 0}
        fps={fps}
        lastMs={lastMs}
      />
    </div>
  );
}
