/**
 * A plain-JS baseline, as a DataGridStore.
 *
 * Everything reactive lives here once, for both baselines: the version a
 * read hook subscribes to, the query and its helpers, views and row ids.
 * So the Grid component renders a baseline exactly the way it renders the
 * engine, and the benchmark calls the same methods on all three.
 */

import type {
  DataGridQuery,
  DataGridSchema,
  DataGridStore,
  DataGridView,
  Row,
  RowIds,
  SchemaSpec,
} from "use-wasm-state/datagrid";
import type { BaselineGrid, FullQuery } from "./baseline";

function rowIds(first: number, length: number): RowIds {
  return {
    first,
    length,
    at: (i) => (i >= 0 && i < length ? first + i : undefined),
    toArray: () => Array.from({ length }, (_, i) => first + i),
    *[Symbol.iterator]() {
      for (let i = 0; i < length; i++) yield first + i;
    },
  };
}

export function createBaselineStore<S extends SchemaSpec>(
  grid: BaselineGrid,
  schema: DataGridSchema<S>
): DataGridStore<S> {
  const listeners = new Set<() => void>();
  let version = 0;
  let revision = 0;
  let lastCallMs = 0;
  let query: Required<DataGridQuery<S>> = { sort: [], filters: [], search: "" };
  let cached: { version: number; start: number; count: number; view: DataGridView<S> } | null =
    null;

  /** Run a mutation, time it, and tell every reader. */
  const mutate = <T>(run: () => T): T => {
    const started = performance.now();
    const result = run();
    lastCallMs = performance.now() - started;
    revision++;
    version++;
    for (const listener of listeners) listener();
    return result;
  };

  const view = (start: number, count: number): DataGridView<S> => {
    if (cached && cached.version === version && cached.start === start && cached.count === count) {
      return cached.view;
    }
    const window = grid.window(start, count);
    const { ids } = window;
    const get = (i: number, column: string) =>
      grid.get(ids[i]!, schema.indexOf[column as keyof S & string]);
    const row = (i: number) => {
      const out = {} as Record<string, unknown>;
      for (const name of schema.names) out[name] = get(i, name);
      return out as Row<S>;
    };
    const value: DataGridView<S> = {
      start: window.start,
      ids,
      length: ids.length,
      get: get as DataGridView<S>["get"],
      row,
      rows: () => (grid.rows ? (grid.rows(ids) as Row<S>[]) : Array.from(ids, (_, i) => row(i))),
    };
    cached = { version, start, count, view: value };
    return value;
  };

  const columnsOf = (rows: readonly Row<S>[]) =>
    schema.names.map((name) => rows.map((row) => row[name])) as unknown as (
      ArrayLike<number> | readonly string[]
    )[];

  const store: DataGridStore<S> = {
    schema,
    mode: "sync",

    insertRows: (rows) => mutate(() => rowIds(grid.insertColumns(columnsOf(rows)), rows.length)),
    insertColumns: (columns) =>
      mutate(() => {
        const ordered = schema.names.map((name) => columns[name]) as unknown as (
          ArrayLike<number> | readonly string[]
        )[];
        return rowIds(grid.insertColumns(ordered), ordered[0]?.length ?? 0);
      }),
    setCell: (rowId, column, value) =>
      mutate(() => grid.setCell(rowId, schema.indexOf[column], value as number | string)),
    deleteRows: (ids) => mutate(() => grid.deleteRows(ids)),

    setQuery: (next) =>
      mutate(() => {
        query = { sort: next.sort ?? [], filters: next.filters ?? [], search: next.search ?? "" };
        grid.setQuery(query as unknown as FullQuery);
      }),
    sortBy: (column, direction) =>
      store.setQuery({ ...query, sort: direction ? [{ column, direction }] : [] }),
    filter: (filters) => store.setQuery({ ...query, filters }),
    search: (search) => store.setQuery({ ...query, search }),
    clearQuery: () => store.setQuery({}),

    get query() {
      return query;
    },
    get version() {
      return version;
    },
    get revision() {
      return revision;
    },
    get lastCallMs() {
      return lastCallMs;
    },
    get rowCount() {
      return grid.rowCount;
    },
    get totalRows() {
      return grid.totalRows;
    },

    view,
    readWindow: async (start, count) => view(start, count),
    watch: () => () => {},
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    dispose() {
      listeners.clear();
      cached = null;
    },
  };

  return store;
}
