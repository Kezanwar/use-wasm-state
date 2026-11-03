# use-wasm-state

React state that lives in a WebAssembly engine written in Go (TinyGo). Not
generic state: each kind of state ships its own prebuilt engine and runs its
operations in wasm. First kind: a datagrid.

Status: pre-release.

## Two entry points

- `use-wasm-state`: what every kind of state shares. The two providers,
  `WasmStateError`, and the shared types. Knows nothing about grids.
- `use-wasm-state/datagrid`: the grid, its hooks, its engine
  (`datagrid.wasm`) and its worker (`datagrid.worker.js`).

## The model

- **Go owns the data.** Rows, the string dictionaries, and the row order.
- **React owns the UI.** Scroll position, selection, edit buffers.
- **A revision drives reactivity.** Every mutation bumps a counter on the
  grid. `useSyncExternalStore` subscribes to that number and nothing else.
- **Only the viewport crosses.** A 200k-row grid answers a scroll by copying
  out the fifty rows on screen.
- **Row ids are permanent.** They are positions in the column slices. A
  delete writes a tombstone; surviving ids never move.
- **String columns are dictionary-encoded.** Cells hold int32 ids; the JS
  side keeps a mirror of the values and resolves ids locally.
- **The hook names the mode.** `Sync` runs the engine on the main thread,
  `Async` in a worker. There is no mode option anywhere.

## Install

```bash
npm install use-wasm-state
```

React 18 or later is a peer dependency.

## A one-off grid

```tsx
import { defineSchema, useDataGridView, useWasmDataGridSync } from "use-wasm-state/datagrid";

const schema = defineSchema({ id: "i32", name: "string", price: "f64" });

function Rows() {
  const { status, grid } = useWasmDataGridSync(schema, {
    initialRows: [{ id: 1, name: "Widget", price: 9.99 }],
  });
  const view = useDataGridView(grid, 0, 50);

  if (status !== "ready") return null;
  return (
    <ul>
      {view?.rows().map((row, i) => (
        <li key={view.ids[i]}>
          {row.name} {row.price}
        </li>
      ))}
    </ul>
  );
}
```

Given a schema, the creation hook owns a private engine with one grid in
it, and disposes both on unmount.

## A shared grid

```tsx
import { WasmStateSyncProvider, useWasmStateSync } from "use-wasm-state";
import { defineDataGrid, useDataGridStats, useWasmDataGridSync } from "use-wasm-state/datagrid";

// Module scope. Does nothing on its own: no engine, no wasm, SSR-safe.
export const Orders = defineDataGrid("orders", schema, { initialRows });

function App() {
  return (
    <WasmStateSyncProvider>
      <Count />
      <List />
    </WasmStateSyncProvider>
  );
}

function Count() {
  const { grid } = useWasmDataGridSync(Orders); // same grid in every component
  return <p>{useDataGridStats(grid)?.rowCount}</p>;
}
```

- Given a `DataGridDef`, the creation hook returns the shared grid from the
  provider of its mode: sync hooks read `WasmStateSyncProvider`, async
  hooks `WasmStateAsyncProvider`. Nesting both works.
- Created by the first hook that uses it, with `initialRows`. Lives as long
  as the provider, not its components: every consumer can unmount and the
  rows are still there.
- `useWasmStateSync().drop(Orders)` (or `useWasmStateAsync()`) disposes it.
  The next use recreates it, `initialRows` again; anything still showing it
  gets the new one.
- A def with no matching provider above it is an error through `status`,
  code `no_provider`, naming the provider it needs.
- Two different defs with the same key in one provider: `schema_mismatch`,
  unless their columns are identical.
- StrictMode: one engine per kind of state per provider, one grid per key,
  `initialRows` inserted once.

## Hooks (`use-wasm-state/datagrid`)

### `useWasmDataGridSync(schemaOrDef, options?)`

Returns a `DataGridStore`. Options, for a schema only: `wasmUrl`,
`initialRows`. Read once, on mount.

### `useWasmDataGridAsync(schemaOrDef, options?)`

Returns an `AsyncDataGridStore`. Options, for a schema only: `wasmUrl`,
`workerUrl`, `initialRows`.

Both return a discriminated union:

```ts
| { status: "loading"; isReady: false; grid: null; error: null }
| { status: "ready";   isReady: true;  grid: T;    error: null }
| { status: "error";   isReady: false; grid: null; error: Error }
```

`isReady` narrows after destructuring; `status` narrows before.

### `useDataGridView(grid, start, count)`

One window, or `null` while loading. Re-renders when the revision moves.

### `useDataGridStats(grid)`

`{ revision, rowCount, totalRows }` or `null`. For headers and status bars.

### `useDataGridQuery(grid)`

The current `{ sort, filters, search }` or `null`. For a toolbar.

All three read hooks take a `DataGridReader`, which both stores satisfy.

## Sort, filter and search

A grid has one query, and the row order is what it produces:

```
live rows -> filters (AND) -> search -> sort
```

It persists: every mutation re-applies it.

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

Numbers take `eq`, `ne`, `lt`, `le`, `gt`, `ge` and `between`; strings take
`eq`, `ne`, `in` and `contains`. `contains` and `search` are
case-insensitive, and `search` looks at every string column. Sorting is
multi-column, stable, and ties break by row id.

## Async

```tsx
const { status, grid } = useWasmDataGridAsync(schema);
await grid.setCell(rowId, "price", 12.5);
await grid.sortBy("price", "desc");
```

Reads stay synchronous, because the worker sends rows for every window on
screen with each reply. Mutations return Promises. While a window is in
flight the store answers with the nearest rows it has, carrying their own
`start`, so a grid draws them where they belong rather than blanking.

A component that awaits every mutation it makes can take
`AnyDataGridStore<S>` (either store) and run under both modes unchanged.

## Stores

### `DataGridStore<S>` (sync)

```ts
insertRows(rows: Row<S>[]): RowIds
insertColumns(columns: ColumnsInput<S>): RowIds
setCell(rowId, column, value): void
deleteRows(rowIds: ArrayLike<number>): void

setQuery(query: DataGridQuery<S>): void   // replaces the whole query
sortBy(column, direction?): void          // no direction clears the sort
filter(clauses: FilterClause<S>[]): void
search(text: string): void
clearQuery(): void
readonly query: Required<DataGridQuery<S>>

readonly revision: number
readonly version: number     // subscription token; moves on any visible change
readonly lastCallMs: number  // what the last engine call cost, engine time only
readonly rowCount: number    // live rows
readonly totalRows: number   // including tombstones

view(start, count): DataGridView<S>                 // best-effort
readWindow(start, count): Promise<DataGridView<S>>  // the real rows
watch(start, count): () => void                     // this window is on screen
subscribe(listener: () => void): () => void
dispose(): void
```

`AsyncDataGridStore<S>` is the same with every mutation returning a Promise.

`RowIds` describes a contiguous run: `{ first, length, at(i), toArray() }`
and iterates. Ids are not materialised as an array.

### `DataGridView<S>`

```ts
readonly start: number     // after clamping, not what you asked for
readonly ids: Int32Array
readonly length: number
get(i, column): value
row(i): Row<S>
rows(): Row<S>[]
```

`view(start, count)` returns the identical object for the same
`(revision, start, count)`.

## Providers (`use-wasm-state`)

`<WasmStateSyncProvider urls?>` and `<WasmStateAsyncProvider urls?>`. No mode
prop: the provider is the mode. `urls` overrides where each kind of state's
engine is fetched from, keyed by its name, read once on mount:

```tsx
<WasmStateAsyncProvider urls={{ datagrid: { wasmUrl, workerUrl } }}>
```

### `WasmStateError`

`{ code, status, op }`. Codes: `bad-handle`, `out-of-range`, `row-deleted`,
`wrong-type`, `row-count`, `bad-schema`, `bad-argument`, `disposed`,
`schema_mismatch`, `no_provider`, `engine`.

## When it pays, and when it does not

Measured against plain JS on 200k rows (`benchmarks.json`, and the
Benchmarks tab on the docs site):

- **Use it for sorting, filtering and searching a large dataset.** Sorts
  are where the engine leads by the widest margin, including the re-sort an
  edit costs while a sort is active.
- **Tuned JS is close on filters and search.** The engine's edge there is
  smaller, and in a browser tuned JS is sometimes ahead.
- **Plain JS is faster at loading, single edits, deletes and reading a
  window** of rows it already holds as objects. For a small or append-only
  list, use `useState`.
- **The main-thread win is frames.** A long JS sort blocks the page for many
  frames; in a worker, the page never stops painting.

## Performance rules

- **Sort, filter and search belong in the query**, not in JS. Reading rows
  out to sort them defeats the whole design.
- **Chunky calls only.** Never loop in JS calling the engine per item.
  `insertColumns` with typed arrays is the fast path; `insertRows` builds
  the columns for you.
- **One crossing per user action or frame.** `setCell`, `view(start, count)`.
- **Load once, then query.** The data stays in Go.
- **Row ids, not offsets.** Offsets shift when rows are deleted.
- **Key virtualised rows by their slot, not their row id.** A sort or a
  filter changes every visible id, and id keys make React destroy and
  rebuild every cell. Keep the id on the element for tests. Id keys are
  right for a list that is not virtualised, where a row keeps its identity.
- **Windows are clamped, never rejected.** Read `view.start` to find out
  where a window actually begins.
- **Async inputs are uncontrolled.** A controlled input waiting a round trip
  for its own value drops keystrokes; use `defaultValue`.

## Serving the engine

`datagrid.wasm` and `datagrid.worker.js` are resolved beside the datagrid
bundle with `new URL("./…", import.meta.url)`, which Vite and webpack 5
understand and which keeps the streaming compile. Pass `wasmUrl` and
`workerUrl` (to a one-off hook, or per pattern to a provider's `urls`) for a
CDN, a strict CSP, or a bundler that cannot resolve the assets. The CJS
build ships a shim for `import.meta.url`.

The engine imports nothing from the host and runs identically on the main
thread, in a worker, and in Node.
