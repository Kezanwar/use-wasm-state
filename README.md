# use-wasm-state

React state that lives in a WebAssembly engine written in Go.

Storing arbitrary JS values in wasm is slower than `useState`, because every
read and write has to serialise. Wasm state only pays off when the operations
on the state also run in wasm. So this is not generic state: each kind of
state ships its own prebuilt engine and does its work in Go, with only what
React needs to render crossing back to JS.

First kind: a datagrid. Sort, filter and search 200k rows while you scroll.

> **Status: early.** Not published yet.

## Install

```bash
npm install use-wasm-state
```

Two entry points: `use-wasm-state` holds what every kind of state shares,
the providers and `WasmStateError`; `use-wasm-state/datagrid` holds the grid,
its hooks, its engine and its worker.

## A grid in twenty lines

```tsx
import { defineSchema, useDataGridView, useWasmDataGridSync } from "use-wasm-state/datagrid";

const schema = defineSchema({ item: "string", qty: "i32", price: "f64" });

export function Basket() {
  const { status, grid } = useWasmDataGridSync(schema, {
    initialRows: [{ item: "Keyboard", qty: 2, price: 89 }],
  });
  const view = useDataGridView(grid, 0, 50);

  if (status !== "ready") return null;

  return (
    <>
      <button onClick={() => grid.insertRows([{ item: "Cable", qty: 8, price: 4.25 }])}>
        Add
      </button>
      <ul>
        {view?.rows().map((row, i) => (
          <li key={view.ids[i]}>
            {row.item} x{row.qty} - {row.price}
          </li>
        ))}
      </ul>
    </>
  );
}
```

## Why the state lives in Go

Storing arbitrary JS values in wasm means serialising on every read, which
is slower than `useState`. It only pays off when the operations on the
state run in wasm too. So Go owns the rows, the string dictionaries and the
row order; React owns the scroll position and the selection.

A counter on the grid bumps on every mutation, `useSyncExternalStore`
watches that counter, and each component reads back only the rows it is
showing.

```tsx
// 200,000 rows live in Go. Fifty cross to JS.
const view = useDataGridView(grid, Math.floor(scrollTop / 32), 50);

// An edit is one call and one revision bump.
grid.setCell(rowId, "price", 12.5);
```

Row ids are permanent positions, so a row keeps its identity across edits
and deletes. In a plain list they are the React key. In a virtualised grid,
key by the slot instead and keep the id as a `data-id`: a sort changes
every visible id, and id keys would make React rebuild every cell.

## Sort, filter and search

A grid has one query, and the row order is what it produces:

```
live rows -> filters (AND) -> search -> sort
```

It persists. Every mutation re-applies it, so an inserted row lands where
the sort says and an edited one leaves a filter it no longer matches.

```tsx
grid.sortBy("price", "desc");
grid.filter([{ column: "status", op: "in", value: ["paid", "shipped"] }]);
grid.search("acme");

grid.setQuery({
  sort: [{ column: "status" }, { column: "price", direction: "desc" }],
  filters: [{ column: "price", op: "between", value: [10, 100] }],
  search: "acme",
});

grid.clearQuery();
```

`sortBy`, `filter` and `search` each replace one part and keep the rest;
`setQuery` replaces the whole thing and clears what you leave out.

Operators are typed by the column they name. Numbers take `eq`, `ne`, `lt`,
`le`, `gt`, `ge` and `between`; strings take `eq`, `ne`, `in` and
`contains`. `contains` and `search` are case-insensitive, and `search`
looks at every string column.

Sorting is multi-column, stable, and ties break by row id. It runs on
unsigned keys rather than values, so a string column sorts by a cached rank
per dictionary entry and a 200k-row sort is one pass over the rows.

`useDataGridQuery(grid)` gives a toolbar the active query, reactive on the
same revision the rows are.

## On the main thread, or in a worker

The hook names the mode. There is no mode option.

`useWasmDataGridSync` runs the engine on the main thread, so a viewport is
read during render and a mutation is visible on the next line.

`useWasmDataGridAsync` moves it into a worker. Reads stay synchronous,
because the worker sends rows for every window on screen with each reply,
so one round trip covers a whole user action. Mutations return Promises,
because they really do cross a thread:

```tsx
const { status, grid } = useWasmDataGridAsync(schema);

await grid.setCell(rowId, "price", 12.5);
await grid.sortBy("price", "desc");
```

The first gives a `DataGridStore`, the second an `AsyncDataGridStore`. Both
satisfy `DataGridReader`, which is what `useDataGridView`,
`useDataGridStats` and `useDataGridQuery` take, so a component that only
reads does not care which it was handed. A component that awaits every
mutation it makes can take `AnyDataGridStore` and run under either mode
unchanged; on a sync store the `await` costs a microtask and nothing else.

While a window is in flight the async store answers with the nearest rows
it already has, carrying their own `start`, so a grid draws them where they
belong rather than blanking.

## Sharing a grid

```tsx
import { WasmStateSyncProvider } from "use-wasm-state";
import { defineDataGrid, useDataGridStats, useWasmDataGridSync } from "use-wasm-state/datagrid";

// Once, at module scope. Nothing loads until a component uses it.
export const Orders = defineDataGrid("orders", schema, { initialRows });

export function App() {
  return (
    <WasmStateSyncProvider>
      <OrderCount />
      <OrderList />
    </WasmStateSyncProvider>
  );
}

function OrderCount() {
  // The same grid in every component that names it.
  const { grid } = useWasmDataGridSync(Orders);
  return <p>{useDataGridStats(grid)?.rowCount}</p>;
}
```

A definition carries its schema with its key, so two components naming a
grid cannot disagree about its shape. The provider creates the grid the
first time a component asks, hands every component the same one, and keeps
it until the provider unmounts: the rows survive every component that
showed them going away. `useWasmStateSync().drop(Orders)` throws it away,
and the next use starts again from `initialRows`.

In a worker it is the same code with `WasmStateAsyncProvider` and
`useWasmDataGridAsync`. Each hook reads the provider of its own mode, so
both can be nested. A definition with no provider of its mode above it is
an error through `status`, code `no_provider`; two different definitions
under one key are `schema_mismatch`, unless their columns are identical.

## Performance

<!-- benchmarks:start -->
<!-- Generated from benchmarks.json by `pnpm bench`. Edit neither by hand. -->

Median of 15 runs over 200,000 rows, on Apple M2 Pro (10 cores, 16 GB), darwin 24.6.0 arm64, Node v22.23.1, 2026-11-03. Fastest in bold.

| | Typical JS | Tuned JS | Wasm |
| --- | ---: | ---: | ---: |
| Load | 28.2 ms | **14.8 ms** | 54.1 ms |
| Sort f64 | 109 ms | 51.8 ms | **7.05 ms** |
| Sort i32 | 59.4 ms | 44.4 ms | **2.39 ms** |
| Sort string | 263 ms | 59.2 ms | **2.61 ms** |
| Sort, two keys | 284 ms | 73.1 ms | **7.81 ms** |
| Filter > | 9.28 ms | **2.28 ms** | 2.47 ms |
| Filter between | 8.88 ms | 3.01 ms | **1.96 ms** |
| Filter string = | 9.07 ms | 2.54 ms | **1.74 ms** |
| Filter string in | 10.6 ms | 3.13 ms | **2.65 ms** |
| Filter contains | 17.0 ms | 2.78 ms | **1.95 ms** |
| Search | 26.4 ms | 3.86 ms | **3.41 ms** |
| Filter + search + sort | 74.4 ms | 23.8 ms | **5.18 ms** |
| setCell | 183 ns | **111 ns** | 194 ns |
| setCell, sorted | 157 ms | 52.5 ms | **6.93 ms** |
| view(50) | **1.58 µs** | 11.4 µs | 13.6 µs |
| Delete 1,000 rows | 5.46 ms | **376 µs** | 1.62 ms |
| JS memory after load | 26.1 MB | 8.4 MB | 2.3 MB |
| Wasm memory after load |  |  | 33.6 MB |

`datagrid.wasm` is 55,173 bytes. The [Benchmarks tab](https://kezanwar.github.io/use-wasm-state/#benchmarks) runs the same benchmark in your browser, and adds what each costs in frames.
<!-- benchmarks:end -->

Wasm's lead is sorting, including the re-sort an edit costs while a sort
is active: the engine radix-sorts integer keys where JS calls a comparator
for every pair. On filters and search, tuned JS, which decides a string
filter once per distinct value the way the engine does, is close and
sometimes ahead. Plain JS wins whatever does not have to cross into wasm:
loading, a single edit, a delete, and reading rows it already holds as
objects. On the main thread the difference is frames as much as
milliseconds; in a worker the page keeps painting through all of it.

An edit is cheap until a sort or filter is active, and then it costs a row
order rebuild, which is O(rows) however small the edit was. That is the
honest price of the design: the order is the output of a stored query, and
one changed cell can move a row anywhere in it.

## Serving the engine

The datagrid's engine is `datagrid.wasm`, a module that imports nothing,
and its worker is `datagrid.worker.js`. Both are resolved beside
the datagrid bundle with `new URL("./…", import.meta.url)`, which Vite and
webpack 5 both understand and which keeps the streaming compile.

```tsx
useWasmDataGridSync(schema, { wasmUrl: "https://cdn.example.com/datagrid.wasm" });

<WasmStateAsyncProvider urls={{ datagrid: { wasmUrl, workerUrl } }}>
```

The CJS build ships a shim for `import.meta.url`; if a bundler still cannot
resolve the assets, pass the URLs. `workerUrl` is also the escape hatch for
a CSP that names an explicit `worker-src`.

There is a [full API reference and live examples](https://kezanwar.github.io/use-wasm-state/),
and [llm.md](./llm.md) is a compact brief to paste into a chat before asking
an assistant for code.

## Layout

```
engine/    Go source for the bundled wasm. `datagrid` is pure Go and tests with
           plain `go test`, `datagrid/wire` is its wire format, `abi` is what
           every pattern shares at the boundary, and `cmd/datagrid` is the
           thin export layer that becomes datagrid.wasm.
src/       the npm package. `core` is the root entry, what every kind of
           state shares: providers, errors, wasm loading and the worker
           plumbing. `datagrid` is the first kind, with its engine.
test/      vitest.
e2e/       Playwright, for the things only a browser can run.
examples/  the Vite docs site: getting started, examples, benchmarks, API.
           The benchmark's baselines and runner live in its src/bench.
scripts/   build and audit the .wasm, run the benchmark.
```

`src/datagrid/datagrid.wasm` is committed, so the tests and the demo run without
TinyGo installed. Rebuild it only when `engine/` changes.

The engine core is plain Go with no wasm in it, so `pnpm test:go` needs no
TinyGo either.

The module is built with TinyGo's `-gc=precise`, not this target's default
`leaking` collector, so a long-lived grid gives memory back. The
measurements behind that choice are in `scripts/build-wasm.mjs`; re-measure
before changing it.

## Scripts

| | |
| --- | --- |
| `pnpm dev` | build the package, run the demo |
| `pnpm test` | vitest |
| `pnpm test:go` | the Go engine core |
| `pnpm test:browser` | Playwright |
| `pnpm typecheck` | package and demo |
| `pnpm build` | tsup -> dist |
| `pnpm build:wasm` | TinyGo -> `src/datagrid/datagrid.wasm`, then audit it |
| `pnpm inspect:wasm` | list the engine's imports and exports |
| `pnpm bench` | measure, write `benchmarks.json` and the README's figures |

`build:wasm` needs TinyGo: `brew tap tinygo-org/tools && brew install tinygo`.
Nothing else does.

## Build order

1. ~~Scaffold workspace, tooling, CI~~
2. ~~`core/wasm` loader and memory helpers, with tests~~
3. ~~Go `datagrid` package: schema, insert, view~~
4. ~~ABI in `cmd/datagrid`, build, `abi.test.ts`~~
5. ~~`SyncClient`, the store and the creation and read hooks~~
6. ~~Demo grid with 200k rows~~
7. ~~Sort, filter, search in Go~~
8. ~~`WorkerClient` + worker mode~~
9. ~~Providers and shared grids~~
10. ~~Benchmarks against plain JS, and release readiness~~

## Licence

MIT
