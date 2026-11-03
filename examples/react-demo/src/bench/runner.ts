/**
 * The benchmark, shared by Node (scripts/benchmark.mjs) and the browser
 * (the Benchmarks tab), so the published figures and the live ones are the
 * same measurement on different machines.
 *
 * One seeded dataset. Every implementation is warmed on every operation
 * before it is timed, everything runs one thing at a time, and each
 * operation is sampled `repeats` times and reported as a median and a p95.
 * Operations too quick to time once are timed in batches and divided.
 */

import type { DataGridStore } from "use-wasm-state/datagrid";
import { generateOrders, orders, STATUSES, type OrderColumns } from "../lib/orders";

type Schema = typeof orders.spec;
type Store = DataGridStore<Schema>;

export type ImplId = "typical" | "tuned" | "wasm";

export interface Instance {
  store: Store;
  /** Bytes of wasm linear memory, for an implementation that has any. */
  linearMemory?(): number;
  dispose(): void;
}

export interface Implementation {
  id: ImplId;
  label: string;
  create(): Promise<Instance>;
}

export interface Stat {
  /** Milliseconds. */
  median: number;
  p95: number;
}

export interface OperationResult {
  id: string;
  label: string;
  results: Record<ImplId, Stat>;
}

export interface MemoryResult {
  /** Bytes of JS memory the loaded grid holds, where the runtime can say. */
  js: number | null;
  /** Bytes of wasm linear memory, for the engine. */
  wasm: number | null;
}

export interface Results {
  rows: number;
  repeats: number;
  operations: OperationResult[];
  memory: Record<ImplId, MemoryResult>;
}

export interface RunOptions {
  rows?: number;
  repeats?: number;
  /**
   * JS memory in use, after a collection if the runtime allows one. Node
   * passes heap plus typed-array storage; a browser cannot see the latter,
   * so it passes nothing rather than a number that undercounts.
   */
  memory?: () => number;
  /** Awaited between samples, so a page can paint and stay responsive. */
  pause?: () => Promise<void>;
  onProgress?: (done: number, total: number, label: string) => void;
}

interface Context {
  data: OrderColumns;
  rows: number;
}

interface Operation {
  id: string;
  label: string;
  /** Calls per sample, for anything too quick to time once. */
  batch?: number;
  /** Needs an empty grid for every sample. */
  fresh?: boolean;
  /** Untimed, before each sample. */
  before?(store: Store, sample: number, context: Context): void;
  run(store: Store, sample: number, call: number, context: Context): unknown;
}

const clear = (store: Store) => {
  const { sort, filters, search } = store.query;
  if (sort.length || filters.length || search) store.clearQuery();
};

const alternate = (sample: number): "asc" | "desc" => (sample % 2 ? "desc" : "asc");

export const OPERATIONS: Operation[] = [
  {
    id: "load",
    label: "Load",
    fresh: true,
    run: (store, _s, _c, { data }) => store.insertColumns(data),
  },
  {
    id: "sort-f64",
    label: "Sort f64",
    before: clear,
    run: (store, s) => store.setQuery({ sort: [{ column: "price", direction: alternate(s) }] }),
  },
  {
    id: "sort-i32",
    label: "Sort i32",
    before: clear,
    run: (store, s) => store.setQuery({ sort: [{ column: "qty", direction: alternate(s) }] }),
  },
  {
    id: "sort-string",
    label: "Sort string",
    before: clear,
    run: (store, s) => store.setQuery({ sort: [{ column: "customer", direction: alternate(s) }] }),
  },
  {
    id: "sort-multi",
    label: "Sort, two keys",
    before: clear,
    run: (store, s) =>
      store.setQuery({
        sort: [{ column: "status" }, { column: "price", direction: alternate(s) }],
      }),
  },
  {
    id: "filter-numeric",
    label: "Filter >",
    before: clear,
    run: (store, s) =>
      store.setQuery({ filters: [{ column: "price", op: "gt", value: 500 + (s % 4) * 250 }] }),
  },
  {
    id: "filter-between",
    label: "Filter between",
    before: clear,
    run: (store, s) =>
      store.setQuery({ filters: [{ column: "price", op: "between", value: [100 + s, 900] }] }),
  },
  {
    id: "filter-eq",
    label: "Filter string =",
    before: clear,
    run: (store, s) =>
      store.setQuery({
        filters: [{ column: "status", op: "eq", value: STATUSES[s % STATUSES.length]! }],
      }),
  },
  {
    id: "filter-in",
    label: "Filter string in",
    before: clear,
    run: (store, s) =>
      store.setQuery({
        filters: [{ column: "status", op: "in", value: STATUSES.slice(0, 2 + (s % 2)) }],
      }),
  },
  {
    id: "filter-contains",
    label: "Filter contains",
    before: clear,
    run: (store, s) =>
      store.setQuery({
        filters: [{ column: "customer", op: "contains", value: ["an", "ra", "el"][s % 3]! }],
      }),
  },
  {
    id: "search",
    label: "Search",
    before: clear,
    run: (store, s) => store.setQuery({ search: ["ship", "ana", "ver"][s % 3]! }),
  },
  {
    id: "combined",
    label: "Filter + search + sort",
    before: clear,
    run: (store, s) =>
      store.setQuery({
        filters: [{ column: "status", op: "in", value: ["paid", "shipped"] }],
        search: "a",
        sort: [{ column: "price", direction: alternate(s) }],
      }),
  },
  {
    id: "setcell",
    label: "setCell",
    batch: 1000,
    before: clear,
    run: (store, s, call, { rows }) =>
      store.setCell((s * 1000 + call) % rows, "price", s + call / 1000),
  },
  {
    id: "setcell-sorted",
    label: "setCell, sorted",
    before: (store) => {
      if (store.query.sort[0]?.column !== "price") store.sortBy("price", "asc");
    },
    run: (store, s, _c, { rows }) => store.setCell((s * 7919) % rows, "price", s),
  },
  {
    id: "view",
    label: "view(50)",
    batch: 1000,
    before: clear,
    run: (store, s, call) =>
      store.view((call * 997 + s * 13) % Math.max(1, store.rowCount - 50), 50).rows(),
  },
  {
    // Last: it is the one operation that changes what the others measure.
    id: "delete",
    label: "Delete 1,000 rows",
    before: clear,
    run: (store, s) => store.deleteRows(Int32Array.from({ length: 1000 }, (_, i) => s * 1000 + i)),
  },
];

const percentile = (sorted: number[], p: number) =>
  sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]!;

function stat(samples: number[]): Stat {
  const sorted = [...samples].sort((a, b) => a - b);
  return { median: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
}

export async function runBenchmarks(
  implementations: Implementation[],
  options: RunOptions = {}
): Promise<Results> {
  const rows = options.rows ?? 200_000;
  const repeats = options.repeats ?? 15;
  const pause = options.pause ?? (async () => {});
  const context: Context = { data: generateOrders(rows), rows };

  const total = implementations.length * (1 + OPERATIONS.length);
  let done = 0;
  const progress = (label: string) => options.onProgress?.(done, total, label);

  // Memory first, one grid at a time, so nothing else is alive to count.
  // Each in a call of its own: a grid held by a variable in this frame
  // would still be reachable when the next one's baseline is taken.
  const memory = {} as Record<ImplId, MemoryResult>;
  for (const impl of implementations) {
    progress(`${impl.label}: memory`);
    memory[impl.id] = await measureMemory(impl, context.data, options.memory);
    done++;
    await pause();
  }

  // One loaded grid per implementation for everything that queries it.
  const loaded = new Map<ImplId, Instance>();
  for (const impl of implementations) {
    const instance = await impl.create();
    instance.store.insertColumns(context.data);
    loaded.set(impl.id, instance);
  }

  const operations: OperationResult[] = [];
  for (const op of OPERATIONS) {
    const results = {} as Record<ImplId, Stat>;
    for (const impl of implementations) {
      progress(`${impl.label}: ${op.label}`);
      const batch = op.batch ?? 1;

      const sample = async (index: number) => {
        const instance = op.fresh ? await impl.create() : loaded.get(impl.id)!;
        op.before?.(instance.store, index, context);
        const started = performance.now();
        for (let call = 0; call < batch; call++) op.run(instance.store, index, call, context);
        const elapsed = (performance.now() - started) / batch;
        if (op.fresh) instance.dispose();
        return elapsed;
      };

      // Warmed with a sample of its own, so the first timed one is not
      // the one that pays for compilation.
      await sample(repeats);
      await pause();

      const samples: number[] = [];
      for (let i = 0; i < repeats; i++) {
        samples.push(await sample(i));
        await pause();
      }
      results[impl.id] = stat(samples);
      done++;
    }
    operations.push({ id: op.id, label: op.label, results });
  }

  for (const instance of loaded.values()) instance.dispose();
  progress("done");
  return { rows, repeats, operations, memory };
}

async function measureMemory(
  impl: Implementation,
  data: OrderColumns,
  measure: (() => number) | undefined
): Promise<MemoryResult> {
  // Let whatever the last measurement left in flight settle first.
  await new Promise((resolve) => setTimeout(resolve, 0));
  const before = measure?.() ?? 0;
  const instance = await impl.create();
  instance.store.insertColumns(data);
  const after = measure?.() ?? 0;
  const result = {
    js: measure ? after - before : null,
    wasm: instance.linearMemory?.() ?? null,
  };
  instance.dispose();
  return result;
}
