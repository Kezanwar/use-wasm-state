/**
 * DataGridStore: one grid on the main thread, framework-agnostic.
 *
 * Holds the handle, keeps a mirror of each string column's dictionary, and
 * caches the most recent viewport so React gets a stable snapshot. Knows
 * nothing about React, and nothing about whether the engine is on this
 * thread or in a worker.
 */

import type { ColumnKind, SyncEngineClient } from "./client";
import { ColumnType } from "./abi";
import { disposedError } from "../core/errors";
import type { ColumnsInput, Row, SchemaSpec, DataGridSchema } from "./schema";
import {
  normalizeQuery,
  toWireQuery,
  type FilterClause,
  type SortDirection,
  type DataGridQuery,
} from "./query";

/* ------------------------------------------------------------------ */
/* Row ids                                                             */
/* ------------------------------------------------------------------ */

/**
 * The ids an insert produced.
 *
 * Ids are always a contiguous run, so this describes it rather than
 * materialising it: an array of 200k numbers is 1.6MB that almost every
 * caller throws away. Iterate it, index it, or call toArray() when you
 * really do want the array.
 */
export interface RowIds extends Iterable<number> {
  /** Id of the first row inserted. */
  readonly first: number;
  /** How many rows were inserted. */
  readonly length: number;
  /** The id at offset i, or undefined past the end. */
  at(i: number): number | undefined;
  toArray(): number[];
}

export function rowIds(first: number, length: number): RowIds {
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

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/**
 * One window of a grid.
 *
 * Columnar inside, because that is how it crossed the boundary and how a
 * grid wants to read it. `row()` and `rows()` build objects only when
 * something actually needs them.
 */
export interface DataGridView<S extends SchemaSpec> {
  /** Where the window begins, after clamping. Not necessarily what was asked for. */
  readonly start: number;
  /** Row ids, in display order. Use these as React keys and for edits. */
  readonly ids: Int32Array;
  /** How many rows came back, which may be fewer than requested. */
  readonly length: number;
  /** One cell, by offset within the window and column name. */
  get<K extends keyof S & string>(i: number, column: K): Row<S>[K];
  /** One row as an object. */
  row(i: number): Row<S>;
  /** Every row in the window as objects. */
  rows(): Row<S>[];
}

/* ------------------------------------------------------------------ */
/* The store                                                           */
/* ------------------------------------------------------------------ */

/**
 * What a grid can be read through, whichever thread its engine is on.
 *
 * The sync and worker stores differ only in their mutations: one returns
 * void, the other a Promise. Reads are identical and synchronous in both,
 * because React reads during render and cannot await. This is what
 * useDataGridView, useDataGridStats and useDataGridQuery take, so a component does
 * not care which mode it was handed.
 */
export interface DataGridReader<S extends SchemaSpec = SchemaSpec> {
  readonly schema: DataGridSchema<S>;

  /**
   * The subscription token: a counter that moves whenever any read could
   * now return something different.
   *
   * Not the revision. In worker mode a window can arrive without the data
   * having changed at all, and a hook keyed on the revision would never
   * re-render to look at it. This is what useSyncExternalStore snapshots.
   */
  readonly version: number;
  /**
   * How long the last engine call took, in milliseconds.
   *
   * The engine's time only: in worker mode it is the round trip, measured
   * before anything re-renders. A caller timing the call itself would
   * fold in React's work on whatever changed, which is not what anyone
   * putting a number on screen is trying to show.
   */
  readonly lastCallMs: number;
  /** Bumped by every mutation that changed something. */
  readonly revision: number;
  /** Live rows. */
  readonly rowCount: number;
  /** Rows ever inserted, tombstones included. */
  readonly totalRows: number;
  /** The query as it was last set. */
  readonly query: Required<DataGridQuery<S>>;

  /**
   * Read a window.
   *
   * The same (revision, start, count) gives back the identical object, so
   * it can be a useSyncExternalStore snapshot.
   */
  view(start: number, count: number): DataGridView<S>;

  /**
   * Read a window, for certain.
   *
   * `view` is best-effort: in worker mode it answers with the nearest rows
   * it already has so a grid never blanks. This waits for the real ones,
   * which is what an operation over rows that are not on screen needs,
   * such as deleting a selected range.
   */
  readWindow(start: number, count: number): Promise<DataGridView<S>>;

  /**
   * Declare that a window is on screen.
   *
   * The sync store has nothing to do with this; the worker store uses it
   * to have every reply carry fresh rows for the windows being shown, so
   * scrolling costs no extra round trip. Returns a function to call when
   * the window goes away.
   */
  watch(start: number, count: number): () => void;

  /** Called after any mutation that moved the revision. */
  subscribe(listener: () => void): () => void;
}

export interface DataGridStore<S extends SchemaSpec = SchemaSpec> extends DataGridReader<S> {
  /** Append rows given as objects. Converted to columns here. */
  insertRows(rows: readonly Row<S>[]): RowIds;
  /**
   * Append rows given as one array per column.
   *
   * The fast path: a Float64Array or Int32Array goes straight into the
   * engine's input buffer with no per-row work on either side.
   */
  insertColumns(columns: ColumnsInput<S>): RowIds;
  /** Write one cell, by row id and column name. */
  setCell<K extends keyof S & string>(rowId: number, column: K, value: Row<S>[K]): void;
  /** Tombstone rows. Surviving row ids do not move. */
  deleteRows(rowIds: ArrayLike<number>): void;

  /**
   * Replace the sort, filters and search.
   *
   * The query persists: every later mutation re-applies it, so an inserted
   * row lands where the sort says and an edited one leaves a filter it no
   * longer matches. Parts left out are cleared; use the methods below to
   * change one and keep the rest.
   */
  setQuery(query: DataGridQuery<S>): void;
  /** Replace the sort with one column. Omit `direction` to clear it. */
  sortBy(column: keyof S & string, direction?: SortDirection): void;
  /** Replace the filters, keeping the sort and the search. */
  filter(clauses: readonly FilterClause<S>[]): void;
  /** Replace the search text, keeping the sort and the filters. */
  search(text: string): void;
  /** Back to live rows in id order. */
  clearQuery(): void;

  /** Drop the grid. Any later call throws. */
  dispose(): void;
}

interface CachedView<S extends SchemaSpec> {
  revision: number;
  start: number;
  count: number;
  value: DataGridView<S>;
}

export function createDataGridStore<S extends SchemaSpec>(
  client: SyncEngineClient,
  handle: number,
  schema: DataGridSchema<S>
): DataGridStore<S> {
  const listeners = new Set<() => void>();

  /**
   * Each string column's dictionary, in id order: the client's own copy,
   * which appends intern against. Dictionaries only ever grow, so it is
   * topped up with what the engine added rather than refetched.
   */
  const mirrors = new Map<number, readonly string[]>();
  for (let i = 0; i < schema.kinds.length; i++) {
    if (schema.kinds[i] === "string") mirrors.set(i, client.dictionarySync(handle, i));
  }

  let disposed = false;
  let version = 0;
  let revision = client.revisionSync(handle);
  let cache: CachedView<S> | null = null;

  // Mirrored rather than read back: it is what we set, and the engine has
  // no reason to disagree. Reading it back would mean decoding a query on
  // every render of a toolbar.
  let query: Required<DataGridQuery<S>> = { sort: [], filters: [], search: "" };

  const alive = (op: string) => {
    if (disposed) throw disposedError(op, "grid");
  };

  /** Top up every string column's mirror. Cheap when nothing was added. */
  const syncDictionaries = () => {
    for (const col of mirrors.keys()) client.dictionarySync(handle, col);
  };

  /**
   * Finish a mutation: re-read the revision and wake subscribers only if
   * it actually moved.
   *
   * The engine leaves it alone for a rejected or empty mutation, so this
   * is what keeps an insert of nothing from re-rendering a grid.
   */
  const settle = (touchedStrings: boolean) => {
    const next = client.revisionSync(handle);
    if (next === revision) return;
    revision = next;
    version++;
    // The cache is keyed on the revision, so a changed revision retires it
    // without having to be cleared. Clearing anyway keeps the window data
    // from outliving the grid it describes.
    cache = null;
    if (touchedStrings) syncDictionaries();
    for (const listener of listeners) listener();
  };

  const store: DataGridStore<S> = {
    schema,

    insertRows(rows) {
      alive("insertRows");
      const columns = schema.names.map((name, col) => {
        const kind = schema.kinds[col]!;
        if (kind === "string") {
          const values = new Array<string>(rows.length);
          for (let r = 0; r < rows.length; r++) values[r] = rows[r]![name] as string;
          return { kind, values } as const;
        }
        const values = kind === "f64" ? new Float64Array(rows.length) : new Int32Array(rows.length);
        for (let r = 0; r < rows.length; r++) values[r] = rows[r]![name] as number;
        return { kind, values } as const;
      });

      const first = client.insertColumnsSync(handle, columns);
      settle(mirrors.size > 0);
      return rowIds(first, rows.length);
    },

    insertColumns(columns) {
      alive("insertColumns");
      let length = -1;
      const payload = schema.names.map((name, col) => {
        const kind = schema.kinds[col]!;
        const values = columns[name] as ArrayLike<number> & readonly string[];
        if (length === -1) length = values.length;
        return kind === "string"
          ? ({ kind, values: values as unknown as readonly string[] } as const)
          : ({ kind, values } as const);
      });

      const first = client.insertColumnsSync(handle, payload);
      settle(mirrors.size > 0);
      return rowIds(first, length === -1 ? 0 : length);
    },

    setCell(rowId, column, value) {
      alive("setCell");
      const col = schema.indexOf[column];
      if (col === undefined) {
        throw new Error(`use-wasm-state: no column named "${String(column)}"`);
      }
      const kind = schema.kinds[col] as ColumnKind;
      client.setCellSync(handle, rowId, col, kind, value as number | string);
      settle(kind === "string");
    },

    deleteRows(ids) {
      alive("deleteRows");
      client.deleteRowsSync(handle, ids);
      settle(false);
    },

    setQuery(next) {
      alive("setQuery");
      const normalized = normalizeQuery(next);
      // Encoded before the call, so a column name the schema does not have
      // throws with that name rather than coming back as a status code.
      client.setQuerySync(handle, toWireQuery(schema, normalized));
      query = normalized;
      settle(false);
    },

    sortBy(column, direction) {
      store.setQuery({
        ...query,
        sort: direction ? [{ column, direction }] : [],
      });
    },

    filter(clauses) {
      store.setQuery({ ...query, filters: clauses });
    },

    search(text) {
      store.setQuery({ ...query, search: text });
    },

    clearQuery() {
      store.setQuery({});
    },

    get query() {
      alive("query");
      return query;
    },

    get version() {
      alive("version");
      return version;
    },
    get lastCallMs() {
      alive("lastCallMs");
      return client.lastCallMs;
    },
    get revision() {
      alive("revision");
      return revision;
    },
    get rowCount() {
      alive("rowCount");
      return client.rowCountSync(handle);
    },
    get totalRows() {
      alive("totalRows");
      return client.totalRowsSync(handle);
    },

    view(start, count) {
      alive("view");
      if (cache && cache.revision === revision && cache.start === start && cache.count === count) {
        return cache.value;
      }

      const decoded = client.viewSync(handle, start, count, schema.columns);
      const value = makeView(schema, decoded, mirrors);
      // One window cached, not a map of them. A grid reads one viewport
      // per render; keeping every window it ever asked for would be a leak
      // dressed up as a cache.
      cache = { revision, start, count, value };
      return value;
    },

    // The engine is on this thread, so the exact rows are always a
    // synchronous read away.
    async readWindow(start: number, count: number) {
      alive("readWindow");
      return store.view(start, count);
    },

    // Nothing to do, for the same reason. It exists so one component can
    // drive either store.
    watch() {
      alive("watch");
      return () => {};
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      cache = null;
      client.dropGridSync(handle);
    },
  };

  return store;
}

export function makeView<S extends SchemaSpec>(
  schema: DataGridSchema<S>,
  decoded: { start: number; ids: Int32Array; columns: (Int32Array | Float64Array)[] },
  mirrors: ReadonlyMap<number, readonly string[]>
): DataGridView<S> {
  const { ids, columns, start } = decoded;
  const length = ids.length;

  const get = (i: number, column: string) => {
    const col = schema.indexOf[column as keyof S & string];
    if (col === undefined) {
      throw new Error(`use-wasm-state: no column named "${column}"`);
    }
    const values = columns[col]!;
    if (schema.kinds[col] !== "string") return values[i] as number;
    // A string column carries dictionary ids; the mirror turns them back
    // into strings without the strings ever crossing per row.
    const mirror = mirrors.get(col)!;
    return mirror[values[i] as number] ?? "";
  };

  const row = (i: number) => {
    const out = {} as Row<S>;
    for (const name of schema.names) {
      (out as Record<string, unknown>)[name] = get(i, name);
    }
    return out;
  };

  return {
    start,
    ids,
    length,
    get: get as DataGridView<S>["get"],
    row,
    rows: () => Array.from({ length }, (_, i) => row(i)),
  };
}

export { ColumnType };
