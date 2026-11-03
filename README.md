# use-wasm-state

React state that lives in a WebAssembly engine written in Go.

Storing arbitrary JS values in wasm is slower than `useState`, because every
read and write has to serialise. Wasm state only pays off when the operations
on the state also run in wasm. So this is not generic state: it ships a
prebuilt engine and exposes specialised data structures whose work happens in
Go, with only what React needs to render crossing back to JS.

First structure: a table. Sort, filter and search 200k rows while you scroll.

> **Status: early.** Not published yet. Sync mode only; worker mode and
> shared tables are not built. See the build order below.

## Install

```bash
npm install use-wasm-state
```

## A table in twenty lines

```tsx
import { defineSchema, useWasmTable, useTableView } from "use-wasm-state";

const schema = defineSchema({ item: "string", qty: "i32", price: "f64" });

export function Basket() {
  const { status, table } = useWasmTable(schema, {
    initialRows: [{ item: "Keyboard", qty: 2, price: 89 }],
  });
  const view = useTableView(table, 0, 50);

  if (status !== "ready") return null;

  return (
    <>
      <button onClick={() => table.insertRows([{ item: "Cable", qty: 8, price: 4.25 }])}>
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

A counter on the table bumps on every mutation, `useSyncExternalStore`
watches that counter, and each component reads back only the rows it is
showing.

```tsx
// 200,000 rows live in Go. Fifty cross to JS.
const view = useTableView(table, Math.floor(scrollTop / 32), 50);

// An edit is one call and one revision bump.
table.setCell(rowId, "price", 12.5);
```

Row ids are permanent positions, so they are stable React keys. A delete
writes a tombstone and nothing moves.

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

## Sync mode

The engine runs on the main thread, so a viewport is read during render and
a mutation is visible on the next line. That is the only mode today. Worker
mode will move the engine off the main thread behind the same API; until it
lands, `mode: "worker"` reports a `not_implemented` error through `status`
rather than failing quietly.

## Serving engine.wasm

The engine is a 38 kB module that imports nothing. It is resolved with
`new URL("./engine.wasm", import.meta.url)`, which Vite and webpack 5 both
understand and which keeps the streaming compile.

```tsx
useWasmTable(schema, { wasmUrl: "https://cdn.example.com/engine.wasm" });
```

The CJS build ships a shim for `import.meta.url`; if a bundler still cannot
resolve the asset, pass `wasmUrl`.

There is a [full API reference and live examples](https://kezanwar.github.io/use-wasm-state/),
and [llm.md](./llm.md) is a compact brief to paste into a chat before asking
an assistant for code.

## Layout

```
engine/    Go source for the bundled wasm. `table` is pure Go and tests with
           plain `go test`; main.go is the thin ABI layer on top.
src/       the npm package: engine clients, stores, React hooks.
test/      vitest.
e2e/       Playwright, for the things only a browser can run.
examples/  the Vite docs site: getting started, live examples, API.
scripts/   build and audit the .wasm.
```

`src/wasm/engine.wasm` is committed, so the tests and the demo run without
TinyGo installed. Rebuild it only when `engine/` changes.

The engine core is plain Go with no wasm in it, so `pnpm test:go` needs no
TinyGo either.

Measured in Node against the committed 25kB module, 200k rows of i32, f64
and dictionary-encoded string:

| | |
| --- | --- |
| `insertColumns` (the whole dataset, one call) | ~14ms |
| `view(start, 50)` including decoding it in JS | ~2.3us |
| `setCell` | ~1.3ms |

`pnpm exec node scripts/bench-engine.mjs` reproduces them.

A cell edit costs more than a viewport read because every mutation rebuilds
the row order, which is O(rows) whatever it touched. That is deliberate: step
7 makes the order the output of a stored sort/filter spec, where one edited
cell can move a row anywhere.

### Known limitation: linear memory only grows

The module ships with TinyGo's `leaking` collector, which never reclaims
anything, so a long-lived table grows and never shrinks (measured: 32MB after
400k rows arriving in batches). `-gc=conservative` holds memory flat but
takes a 200k-row insert from 11ms to 1,700ms, which is worse. See the note in
`scripts/build-wasm.mjs`, and re-measure when TinyGo's wasm GC improves.

## Scripts

| | |
| --- | --- |
| `pnpm dev` | build the package, run the demo |
| `pnpm test` | vitest |
| `pnpm test:go` | the Go engine core |
| `pnpm test:browser` | Playwright |
| `pnpm typecheck` | package and demo |
| `pnpm build` | tsup -> dist |
| `pnpm build:wasm` | TinyGo -> `src/wasm/engine.wasm`, then audit it |
| `pnpm inspect:wasm` | list the engine's imports and exports |

`build:wasm` needs TinyGo: `brew tap tinygo-org/tools && brew install tinygo`.
Nothing else does.

## Build order

1. ~~Scaffold workspace, tooling, CI~~
2. ~~Copy the `internal/wasm` helpers and their tests~~
3. ~~Go `table` package: schema, insert, view~~
4. ~~ABI in `main.go`, build, `abi.test.ts`~~
5. ~~`SyncClient` + `TableStore` + `useWasmTable` / `useTableView`~~
6. ~~Demo grid with 200k rows~~
7. ~~Sort, filter, search in Go~~
8. `WorkerClient` + worker mode
9. Provider / shared tables
10. Benchmarks against a plain JS implementation, docs

## A note on `src/internal/wasm/`

Those three files are copied from
[react-use-wasm](https://github.com/Kezanwar/react-use-wasm) with their tests,
stripped of anything hook-shaped. The two libraries have different lifecycles
(a shared engine instance versus one module per component), so they are not
built on each other yet. Each copied file says so in its header. If the
duplication starts to hurt, they get extracted into a shared core.

They are deliberately not re-exported from `src/index.ts`.

## Licence

MIT
