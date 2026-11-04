import { AnchorLink, slug } from "@/components/Anchor";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Play } from "lucide-react";
import { cn } from "cn";
import { useWasmDataGridAsync, type AnyDataGridStore } from "use-wasm-state/datagrid";
import wasmUrl from "use-wasm-state/datagrid.wasm?url";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SideBySide } from "@/components/SideBySide";
import { SpeedChart } from "@/components/SpeedChart";
import { runInBrowser } from "@/bench/browser";
import { PUBLISHED } from "@/bench/figures";
import { formatMB, formatMs } from "@/bench/format";
import { frameBudget, measureFrames, type FrameCost } from "@/bench/frames";
import { implementations, LABELS } from "@/bench/implementations";
import type { ImplId, MemoryResult, Results } from "@/bench/runner";
import { winners } from "@/bench/winners.mjs";
import { generateOrders, orders } from "@/lib/orders";

type Schema = typeof orders.spec;

const IMPLS: ImplId[] = ["typical", "tuned", "wasm"];

/** A winning value: green, and bold so it never rests on colour alone. */
const WIN = "text-emerald-700 dark:text-emerald-400 font-semibold";

/** ?quick shrinks the run to seconds, for the browser tests. */
const QUICK = typeof location !== "undefined" && new URLSearchParams(location.search).has("quick");
const RUN = QUICK ? { rows: 20_000, repeats: 2 } : { rows: 200_000, repeats: 7 };

const FRAME_ROWS = [
  { id: "typical", label: LABELS.typical },
  { id: "tuned", label: LABELS.tuned },
  { id: "wasm", label: "Wasm on the main thread" },
  { id: "worker", label: "Wasm in a worker" },
] as const;

type FrameId = (typeof FRAME_ROWS)[number]["id"];

interface LiveRun {
  done: number;
  total: number;
  label: string;
  results?: Results;
  frames?: Record<FrameId, FrameCost>;
}

export function BenchmarksPage() {
  const [live, setLive] = useState<LiveRun | null>(null);
  const [shown, setShown] = useState<"published" | "live">("published");
  const [probe, setProbe] = useState<((grid: AnyDataGridStore<Schema>) => void) | null>(null);

  const running = live !== null && !live.frames;
  const results = shown === "live" && live?.results ? live.results : PUBLISHED;

  const run = async () => {
    setLive({ done: 0, total: 1, label: "Starting" });
    const timed = await runInBrowser((done, total, label) => setLive({ done, total, label }), RUN);
    setLive({ done: 1, total: 1, label: "Frames", results: timed });

    // The worker comes through the public hook, mounted for the run.
    const worker = await new Promise<AnyDataGridStore<Schema>>((resolve) =>
      setProbe(() => resolve)
    );
    const frames = await measureSortFrames(worker, RUN.rows);
    setProbe(null);
    setLive({ done: 1, total: 1, label: "Done", results: timed, frames });
    setShown("live");
  };

  return (
    <div className="space-y-6">
      <p className="text-muted-foreground text-sm">
        The engine against typical and hand-optimised JS on the same data, in milliseconds and in
        frames.
      </p>
      <Card id="results" className="scroll-mt-6">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div className="space-y-1">
            <CardTitle className="group/heading flex items-center gap-2 text-base">
              {results.rows.toLocaleString("en-US")} rows
              <AnchorLink id="results" />
            </CardTitle>
            <p className="text-muted-foreground text-sm" data-testid="bench-summary">
              {summary(results)}
            </p>
            <p className="text-muted-foreground text-sm">
              Each figure is the median of {results.repeats} runs after a warm-up, one operation at
              a time. Lower is better; the best in each row, and anything within 5% of it, is in
              green.
            </p>
          </div>
          {live?.results && (
            <Switch
              value={shown}
              onChange={setShown}
              options={[
                ["published", "Published"],
                ["live", "This machine"],
              ]}
            />
          )}
        </CardHeader>
        <CardContent className="space-y-6">
          <SpeedChart results={results} />

          <div className="grid gap-6 md:grid-cols-2">
            <FiguresTable
              title="Published"
              caption={`${PUBLISHED.machine.cpu} · ${PUBLISHED.runtime.name} ${PUBLISHED.runtime.version} · ${PUBLISHED.measured}`}
              results={PUBLISHED}
              testId="bench-published"
            />
            {live?.results ? (
              <FiguresTable
                title="This machine"
                caption={`This browser · median of ${live.results.repeats}`}
                results={live.results}
                testId="bench-live"
              />
            ) : (
              <div className="flex flex-col items-start justify-center gap-3 rounded-lg border border-dashed p-6">
                <Button onClick={() => void run()} disabled={running} data-testid="bench-run">
                  <Play /> Run on this machine
                </Button>
                {running && (
                  <div className="w-full space-y-1.5" data-testid="bench-progress">
                    <div className="bg-muted h-1 overflow-hidden rounded-full">
                      <div
                        className="bg-primary h-full transition-[width]"
                        style={{ width: `${(100 * live.done) / Math.max(1, live.total)}%` }}
                      />
                    </div>
                    <p className="text-muted-foreground text-xs">{live.label}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card id="frames" className="scroll-mt-6">
        <CardHeader>
          <CardTitle className="group/heading flex items-center gap-2 text-base">
            Frames
            <AnchorLink id="frames" />
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            On the main thread the cost is frames, not just milliseconds. Sort a column on each
            side.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <SideBySide />
          {live?.frames && live.results && (
            <FramesTable frames={live.frames} rows={live.results.rows} />
          )}
        </CardContent>
      </Card>

      {probe && <WorkerProbe rows={RUN.rows} onReady={probe} />}
    </div>
  );
}

/** Where wasm wins, and where JS is ahead or close, from the figures shown. */
function summary(results: Results): string {
  const ops = results.operations;
  const fastest = (op: Results["operations"][number]) =>
    IMPLS.reduce((a, b) => (op.results[b].median < op.results[a].median ? b : a));
  const wasm = ops.filter((op) => fastest(op) === "wasm");
  const ahead = ops.filter((op) => fastest(op) !== "wasm");
  const close = wasm.filter((op) => op.results.tuned.median / op.results.wasm.median <= 1.5);

  let text = `Wasm is fastest at ${wasm.length} of ${ops.length}.`;
  if (ahead.length) text += ` JS is ahead on ${list(ahead.map((op) => op.label))}.`;
  if (close.length)
    text += ` ${LABELS.tuned} is within 1.5× on ${list(close.map((op) => op.label))}.`;
  return text;
}

const list = (items: string[]) =>
  items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

function FiguresTable({
  title,
  caption,
  results,
  testId,
}: {
  title: string;
  caption: string;
  results: Results;
  testId: string;
}) {
  return (
    <div id={slug(title)} className="min-w-0 scroll-mt-6 space-y-2" data-testid={testId}>
      <div>
        <h3 className="group/heading flex items-center gap-2 text-sm font-medium">
          {title}
          <AnchorLink id={slug(title)} />
        </h3>
        <p className="text-muted-foreground truncate text-xs">{caption}</p>
      </div>
      <table className="w-full text-xs">
        <thead className="text-muted-foreground">
          <tr>
            <th />
            {IMPLS.map((id) => (
              <th key={id} className="py-1 text-right font-medium">
                {LABELS[id]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="tabular">
          {results.operations.map((op) => {
            const wins = winners(IMPLS.map((id) => op.results[id].median));
            return (
              <tr key={op.id} className="border-border/50 border-t">
                <td className="text-muted-foreground py-1 pr-2">{op.label}</td>
                {IMPLS.map((id, i) => (
                  <td
                    key={id}
                    className={cn("py-1 text-right", wins[i] && WIN)}
                    title={`p95 ${formatMs(op.results[id].p95)}`}
                  >
                    {formatMs(op.results[id].median)}
                  </td>
                ))}
              </tr>
            );
          })}
          {IMPLS.every((id) => results.memory[id]?.js != null) && (
            <MemoryRow
              label="JS memory"
              cells={IMPLS.map((id) => formatMB(results.memory[id]!.js!))}
              wins={winners(IMPLS.map((id) => results.memory[id]!.js))}
            />
          )}
          <MemoryRow
            label="Wasm memory, reserved / live"
            cells={IMPLS.map((id) => wasmMemory(results.memory[id]))}
          />
        </tbody>
      </table>
      {IMPLS.every((id) => results.memory[id]?.js != null) && (
        <p className="text-muted-foreground text-xs">
          Typical JS's heap leaves out the strings it shares with the input.
        </p>
      )}
    </div>
  );
}

/** Reserved linear memory, and the engine's live heap within it. */
function wasmMemory(memory: MemoryResult | undefined): string {
  if (memory?.wasm == null) return "";
  return memory.wasmLive == null
    ? formatMB(memory.wasm)
    : `${formatMB(memory.wasm)} / ${formatMB(memory.wasmLive)}`;
}

function MemoryRow({ label, cells, wins }: { label: string; cells: string[]; wins?: boolean[] }) {
  return (
    <tr className="border-border/50 border-t">
      <td className="text-muted-foreground py-1 pr-2">{label}</td>
      {cells.map((text, i) => (
        <td key={i} className={cn("py-1 text-right", wins?.[i] && WIN)}>
          {text}
        </td>
      ))}
    </tr>
  );
}

function FramesTable({ frames, rows }: { frames: Record<FrameId, FrameCost>; rows: number }) {
  // Each column is its own contest: shortest longest frame, fewest dropped.
  const worst = winners(FRAME_ROWS.map(({ id }) => frames[id].worst));
  const dropped = winners(FRAME_ROWS.map(({ id }) => frames[id].dropped));
  return (
    <table className="w-full max-w-lg text-xs" data-testid="bench-frames">
      <thead className="text-muted-foreground">
        <tr>
          <th className="py-1 text-left font-medium">
            Sorting {rows.toLocaleString("en-US")} rows by price
          </th>
          <th className="py-1 text-right font-medium">Longest frame</th>
          <th className="py-1 text-right font-medium">Dropped</th>
        </tr>
      </thead>
      <tbody className="tabular">
        {FRAME_ROWS.map(({ id, label }, i) => (
          <tr key={id} className="border-border/50 border-t">
            <td className="py-1">{label}</td>
            <td className={cn("py-1 text-right", worst[i] && WIN)}>{formatMs(frames[id].worst)}</td>
            <td className={cn("py-1 text-right", dropped[i] && WIN)}>{frames[id].dropped}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * What sorting costs the page, for each implementation. The median of five
 * sorts each, alternating direction so every one does real work.
 */
async function measureSortFrames(
  worker: AnyDataGridStore<Schema>,
  rows: number
): Promise<Record<FrameId, FrameCost>> {
  const budget = await frameBudget();
  const data = generateOrders(rows);
  const stores: [FrameId, AnyDataGridStore<Schema>, () => void][] = [];
  for (const impl of implementations(new URL(wasmUrl, location.href).href)) {
    const instance = await impl.create();
    instance.store.insertColumns(data);
    stores.push([impl.id as FrameId, instance.store, instance.dispose]);
  }
  stores.push(["worker", worker, () => {}]);

  const out = {} as Record<FrameId, FrameCost>;
  for (const [id, store, dispose] of stores) {
    const costs: FrameCost[] = [];
    for (let i = 0; i < 5; i++) {
      costs.push(await measureFrames(() => store.sortBy("price", i % 2 ? "desc" : "asc"), budget));
    }
    const median = (values: number[]) => [...values].sort((a, b) => a - b)[2]!;
    out[id] = {
      worst: median(costs.map((c) => c.worst)),
      dropped: median(costs.map((c) => c.dropped)),
    };
    dispose();
  }
  return out;
}

/** A worker grid through the public hook, loaded and handed back once. */
function WorkerProbe({
  rows,
  onReady,
}: {
  rows: number;
  onReady: (grid: AnyDataGridStore<Schema>) => void;
}) {
  const { grid } = useWasmDataGridAsync(orders);
  const sent = useRef(false);
  useEffect(() => {
    if (!grid || sent.current) return;
    sent.current = true;
    void grid.insertColumns(generateOrders(rows)).then(() => onReady(grid));
  }, [grid, rows, onReady]);
  return null;
}

function Switch<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: [T, ReactNode][];
}) {
  return (
    <div className="flex shrink-0 items-center rounded-md border p-0.5" role="group">
      {options.map(([key, label]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          data-testid={`bench-show-${key}`}
          onClick={() => onChange(key)}
          className={cn(
            "rounded px-2.5 py-1 text-xs transition-colors",
            value === key
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
