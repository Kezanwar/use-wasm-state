# use-wasm-state

React state that lives in a WebAssembly engine written in Go.

Storing arbitrary JS values in wasm is slower than `useState`, because every
read and write has to serialise. Wasm state only pays off when the operations
on the state also run in wasm. So this is not generic state: it ships a
prebuilt engine and exposes specialised data structures whose work happens in
Go, with only what React needs to render crossing back to JS.

First structure: a table. Sort, filter, group and search 200k rows while you
scroll.

> **Status: early.** Nothing is published and the public API is empty. See
> the build order below for where it is up to.

## How it is meant to work

```tsx
const rows = useWasmTable(schema, { shared: "orders", mode: "worker" });

rows.insertMany(data);              // loaded once
rows.sortBy("price", "desc");       // runs in Go
rows.filter("status", "=", "shipped");

const visible = rows.view(0, 50);   // only the viewport crosses over
```

Go owns the domain data: rows, indexes, sort and filter state. React owns UI
state: selection, scroll, edit buffers. Go keeps a revision counter that
every mutation bumps, React subscribes to it with `useSyncExternalStore`, and
a component re-reads only its own viewport.

## Layout

```
engine/    Go source for the bundled wasm. `table` is pure Go and tests with
           plain `go test`; main.go is the thin ABI layer on top.
src/       the npm package: engine clients, stores, React hooks.
test/      vitest.
e2e/       Playwright, for the things only a browser can run.
examples/  the Vite demo.
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
7. Sort, filter, search in Go
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
