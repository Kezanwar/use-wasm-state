import { useEffect, useRef, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import {
  useDataGridStats,
  useWasmDataGridAsync,
  type AnyDataGridStore,
} from "use-wasm-state/datagrid";
import { Grid } from "@/components/Grid";
import { frameBudget, measureFrames, type FrameCost } from "@/bench/frames";
import { formatMs } from "@/bench/format";
import { LABELS } from "@/bench/implementations";
import { createBaselineStore } from "@/bench/store";
import { createTypicalGrid } from "@/bench/typical";
import { useFrameRate } from "@/hooks/useFrameRate";
import { generateOrders, orders } from "@/lib/orders";

type Schema = typeof orders.spec;

const ROWS = 200_000;

/**
 * The same grid twice: plain JS on the left, the engine in a worker on the
 * right. One Grid component and one virtual window for both, so the only
 * difference is where the rows live and where a sort runs. Sort a column
 * on each and watch the frames.
 */
export function SideBySide() {
  const left = useBaselineGrid();
  const right = useWorkerGrid();

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Pane
        grid={left}
        testId="side-js"
        title={<span className="px-1 text-xs font-medium">{LABELS.typical}</span>}
      />
      <Pane
        grid={right}
        testId="side-wasm"
        title={<span className="px-1 text-xs font-medium">Wasm in a worker</span>}
      />
    </div>
  );
}

/** The typical-JS baseline behind the store interface, loaded once. */
function useBaselineGrid(): AnyDataGridStore<Schema> | null {
  const [grid, setGrid] = useState<AnyDataGridStore<Schema> | null>(null);
  useEffect(() => {
    // A frame first, so the page paints before the load blocks.
    const id = requestAnimationFrame(() => {
      const store = createBaselineStore(createTypicalGrid(orders), orders);
      store.insertColumns(generateOrders(ROWS));
      setGrid(store);
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return grid;
}

/** The engine in a worker, through the public hook, loaded once. */
function useWorkerGrid(): AnyDataGridStore<Schema> | null {
  const { grid } = useWasmDataGridAsync(orders);
  const loaded = useRef(false);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!grid || loaded.current) return;
    loaded.current = true;
    void grid.insertColumns(generateOrders(ROWS)).then(() => setReady(true));
  }, [grid]);
  return ready ? grid : null;
}

function Pane({
  grid,
  title,
  testId,
}: {
  grid: AnyDataGridStore<Schema> | null;
  title: ReactNode;
  testId: string;
}) {
  const stats = useDataGridStats(grid);
  const [selection, setSelection] = useState<{ anchor: number; focus: number } | null>(null);
  const [cost, setCost] = useState<FrameCost | null>(null);
  const [search, setSearch] = useState("");
  // The display's frame, measured once while idle. Until then, 60 Hz.
  const budget = useRef(1000 / 60);
  useEffect(() => {
    void frameBudget(10).then((ms) => (budget.current = ms));
  }, []);

  // What the last action cost the page, measured from the frame before it
  // until its result has painted.
  const measure = async (run: () => unknown) => {
    setCost(await measureFrames(run, budget.current));
  };

  return (
    <div className="flex h-[26rem] flex-col overflow-hidden rounded-xl border" data-testid={testId}>
      <header className="flex h-11 shrink-0 items-center justify-between gap-2 border-b px-2">
        {title}
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
          <input
            type="search"
            value={search}
            placeholder="Search"
            disabled={!grid}
            data-testid={`${testId}-search`}
            onChange={(event) => {
              const text = event.target.value;
              setSearch(text);
              if (grid) void measure(() => grid.search(text));
            }}
            className="focus-visible:ring-ring/50 h-7 w-36 rounded-md border bg-transparent pr-2 pl-7 text-sm outline-none focus-visible:ring-[3px]"
          />
        </div>
      </header>

      {grid && stats ? (
        <Grid
          grid={grid}
          rowCount={stats.rowCount}
          selection={selection}
          onSelectionChange={setSelection}
          onEdit={(run) => void measure(run)}
          onSort={(run) => void measure(run)}
        />
      ) : (
        <div className="bg-muted/30 flex-1 animate-pulse" />
      )}

      <FrameMeter cost={cost} testId={testId} />
    </div>
  );
}

/**
 * Two numbers. The live rate is the page's, so it stalls on both sides
 * while either blocks; the last action's cost is this side's own.
 */
function FrameMeter({ cost, testId }: { cost: FrameCost | null; testId: string }) {
  const fps = useFrameRate();
  return (
    <footer className="text-muted-foreground tabular flex h-8 shrink-0 items-center gap-4 border-t px-3 font-mono text-xs">
      <span>{fps === 0 ? "" : `${fps} fps`}</span>
      <span className="ml-auto" data-testid={`${testId}-cost`}>
        {cost && `longest frame ${formatMs(cost.worst)} · ${cost.dropped} dropped`}
      </span>
    </footer>
  );
}
