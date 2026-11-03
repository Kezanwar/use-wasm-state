# use-wasm-state

React state that lives in a WebAssembly engine written in Go (TinyGo). Not
generic state: it ships a prebuilt engine and exposes data structures whose
operations run in wasm. First structure: a table.

Status: pre-release. Sync and worker modes both work. Shared tables are not
implemented and report a recognisable error.

## The model

- **Go owns the data.** Rows, the string dictionaries, and the row order.
- **React owns the UI.** Scroll position, selection, edit buffers.
- **A revision drives reactivity.** Every mutation bumps a `uint32` on the
  table. `useSyncExternalStore` subscribes to that number and nothing else.
- **Only the viewport crosses.** A 200k-row table answers a scroll by
  copying out the fifty rows on screen.
- **Row ids are permanent.** They are positions in the column slices. A
  delete writes a tombstone; surviving ids never move, so they are stable
  React keys.
- **String columns are dictionary-encoded.** Cells hold int32 ids;
  the JS side keeps a mirror of the values and resolves ids locally.

## Install

```bash
npm install use-wasm-state
```

React 18 or later is a peer dependency.

## Hooks

```tsx
import { defineSchema, useWasmTable, useTableView } from "use-wasm-state";

const schema = defineSchema({ id: "i32", name: "string", price: "f64" });

function Rows() {
  const { status, table } = useWasmTable(schema, {
    initialRows: [{ id: 1, name: "Widget", price: 9.99 }],
  });
  const view = useTableView(table, 0, 50);

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

### `defineSchema(spec)`

`spec` maps column name to `"i32" | "f64" | "string"`. Key order is column
order. The row type is inferred: `Row<typeof schema.spec>`.

### `useWasmTable(schema, options?)`

Creates a private engine with one table. Returns a discriminated union:

```ts
| { status: "loading"; isReady: false; table: null; error: null }
| { status: "ready";   isReady: true;  table: TableStore<S>; error: null }
| { status: "error";   isReady: false; table: null; error: Error }
```

`isReady` narrows after destructuring; `status` narrows before.

Options: `wasmUrl`, `workerUrl`, `initialRows`, `mode` (`"sync"` or
`"worker"`), `shared` (not implemented). The schema is read once on mount.

### `useTableView(table, start, count)`

One window, or `null` while loading. Re-renders when the revision moves.

### `useTableStats(table)`

`{ revision, rowCount, totalRows }` or `null`. For headers and status bars
that must update without reading rows.

### `useTableQuery(table)`

The current `{ sort, filters, search }` or `null`. For a toolbar.

All three read hooks take a `TableReader`, which both store types satisfy.

## Sort, filter and search

A table has one query, and the row order is what it produces:

```
live rows -> filters (AND) -> search -> sort
```

It persists. Every mutation re-applies it, so an inserted row lands where
the sort says and an edited one leaves a filter it no longer matches.

```tsx
table.sortBy("price", "desc");
table.filter([{ column: "status", op: "in", value: ["paid", "shipped"] }]);
table.search("acme");

table.setQuery({
  sort: [{ column: "status" }, { column: "price", direction: "desc" }],
  filters: [{ column: "price", op: "between", value: [10, 100] }],
  search: "acme",
});

table.clearQuery();
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

`useTableQuery(table)` gives a toolbar the active query, reactive on the
same revision the rows are.

## Worker mode

```tsx
const { status, table } = useWasmTable(schema, { mode: "worker" });
```

The engine moves off the main thread. Reads stay synchronous, because the
worker sends rows for every window on screen with each reply, so one round
trip covers a whole user action. Mutations return Promises, because they
really do cross a thread:

```tsx
await table.setCell(rowId, "price", 12.5);
await table.sortBy("price", "desc");
```

The option types the result: `mode: "worker"` gives an `AsyncTableStore`,
anything else a `TableStore`. Both satisfy `TableReader`, which is what
`useTableView`, `useTableStats` and `useTableQuery` take, so a component
that only reads does not care which it was handed.

While a window is in flight the store answers with the nearest rows it
already has, carrying their own `start`, so a grid draws them where they
belong rather than blanking.

The worker bundle is resolved with `new URL("./worker.js", import.meta.url)`,
the same way `engine.wasm` is. Pass `workerUrl` where a CSP names an
explicit `worker-src`.

## Store

`createEngine(options?) -> Promise<Engine>` for use outside React.
`engine.createTable(schema) -> TableStore`, `engine.dispose()`.

### `TableStore<S>`

```ts
insertRows(rows: Row<S>[]): RowIds
insertColumns(columns: ColumnsInput<S>): RowIds
setCell(rowId, column, value): void
deleteRows(rowIds: ArrayLike<number>): void

setQuery(query: TableQuery<S>): void      // replaces the whole query
sortBy(column, direction?): void          // no direction clears the sort
filter(clauses: FilterClause<S>[]): void
search(text: string): void
clearQuery(): void
readonly query: Required<TableQuery<S>>

readonly revision: number
readonly rowCount: number    // live rows
readonly totalRows: number   // including tombstones

view(start, count): TableView<S>              // best-effort
readWindow(start, count): Promise<TableView<S>>  // the real rows
watch(start, count): () => void               // this window is on screen
subscribe(listener: () => void): () => void
dispose(): void
```

`RowIds` describes a contiguous run: `{ first, length, at(i), toArray() }`
and iterates. Ids are not materialised as an array.

### `TableView<S>`

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

### `WasmStateError`

`{ code, status, op }`. Codes: `bad-handle`, `out-of-range`, `row-deleted`,
`wrong-type`, `row-count`, `bad-schema`, `bad-argument`, `disposed`,
`not_implemented`, `engine`.

## Performance rules

- **Sort, filter and search belong in the query**, not in JS. Reading rows
  out to sort them defeats the whole design.
- **Chunky calls only.** Never loop in JS calling the engine per item.
  `insertColumns` with typed arrays is the fast path; `insertRows` builds
  the columns for you.
- **One crossing per user action or frame.** `setCell`, `view(start, count)`.
- **Load once, then query.** The data stays in Go.
- **Never cache a typed-array view on `memory.buffer`.** A grow detaches it.
- **Row ids, not offsets.** Offsets shift when rows are deleted.
- **Windows are clamped, never rejected.** Read `view.start` to find out
  where a window actually begins.

## Serving engine.wasm

Resolved by default with `new URL("./engine.wasm", import.meta.url)`, which
Vite and webpack 5 understand and which keeps the streaming compile. Pass
`wasmUrl` for a CDN, a strict CSP, or a bundler that cannot resolve the
asset. The CJS build ships a shim for `import.meta.url`; if your bundler
still cannot resolve it, pass `wasmUrl`.

The module imports nothing from the host and runs identically on the main
thread, in a worker, and in Node.

## What is not built yet

`options.shared`. It reports a `WasmStateError` with code
`not_implemented` rather than failing quietly.
