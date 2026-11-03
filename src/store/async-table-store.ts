/**
 * TableStore for an engine running in a worker.
 *
 * Reads are the same as the sync store and stay synchronous, because React
 * reads during render and cannot await. Mutations return Promises, because
 * they really do cross a thread.
 *
 * The trick that makes the reads work is that the worker sends rows back
 * with every reply, for every window the store says is on screen. One round
 * trip per user action, and nothing ever has to ask "what does row 400 say"
 * and wait.
 */

import type { ColumnSpec, DecodedView } from "../engine/abi";
import type { WorkerClient } from "../engine/worker-client";
import { disposedError } from "../engine/errors";
import type { TableUpdate, WindowSpec } from "../engine/protocol";
import {
  normalizeQuery,
  toWireQuery,
  type FilterClause,
  type SortDirection,
  type TableQuery,
} from "./query";
import type { ColumnKind, ColumnsInput, Row, SchemaSpec, TableSchema } from "./schema";
import { makeView, rowIds, type RowIds, type TableReader, type TableView } from "./table-store";

export interface AsyncTableStore<S extends SchemaSpec = SchemaSpec> extends TableReader<S> {
  insertRows(rows: readonly Row<S>[]): Promise<RowIds>;
  insertColumns(columns: ColumnsInput<S>): Promise<RowIds>;
  setCell<K extends keyof S & string>(rowId: number, column: K, value: Row<S>[K]): Promise<void>;
  deleteRows(rowIds: ArrayLike<number>): Promise<void>;

  setQuery(query: TableQuery<S>): Promise<void>;
  sortBy(column: keyof S & string, direction?: SortDirection): Promise<void>;
  filter(clauses: readonly FilterClause<S>[]): Promise<void>;
  search(text: string): Promise<void>;
  clearQuery(): Promise<void>;

  dispose(): void;
}

/** One window's rows, as the worker last sent them. */
interface CachedWindow<S extends SchemaSpec> {
  start: number;
  count: number;
  revision: number;
  value: TableView<S>;
}

/**
 * Build a store for a table the worker is still creating.
 *
 * The handle arrives a round trip later, but createTable stays synchronous
 * in both modes so a component is written the same way whichever it got.
 * Until it lands, reads answer from an empty cache and mutations wait: the
 * store is simply a table with no rows yet, which is what it is.
 */
export function createAsyncTableStore<S extends SchemaSpec>(
  client: WorkerClient,
  pending: Promise<number>,
  schema: TableSchema<S>
): AsyncTableStore<S> {
  const listeners = new Set<() => void>();
  const mirrors = new Map<number, string[]>();
  for (let i = 0; i < schema.kinds.length; i++) {
    if (schema.kinds[i] === "string") mirrors.set(i, []);
  }

  let disposed = false;
  let version = 0;
  // Captured when the reply lands, before anything re-renders.
  let lastCallMs = 0;
  let handle = -1;
  let revision = 0;
  let rowCount = 0;
  let totalRows = 0;
  let query: Required<TableQuery<S>> = { sort: [], filters: [], search: "" };

  /**
   * Windows that are on screen, ref-counted because two components can ask
   * for the same one and only the last to leave should retire it.
   */
  const wanted = new Map<string, { spec: WindowSpec; refs: number }>();
  const cache = new Map<string, CachedWindow<S>>();
  /**
   * Windows already asked for and not yet answered.
   *
   * A fast scroll walks through a new window every frame, and without this
   * each one would be requested again by anything that looked at it. The
   * replies all arrive, each one decoding rows and re-rendering, and the
   * main thread ends up busy with work it asked for twice.
   */
  const inFlight = new Set<string>();

  const key = (start: number, count: number) => `${start}:${count}`;

  const publishWindows = () => {
    if (handle === -1) return;
    client.setWindows(
      handle,
      [...wanted.values()].map((entry) => entry.spec)
    );
  };

  const alive = (op: string) => {
    if (disposed) throw disposedError(op, "table");
  };

  /** Ask for a window, unless the same one is already on its way. */
  const request = async (start: number, count: number) => {
    const id = key(start, count);
    if (inFlight.has(id)) return;
    inFlight.add(id);
    try {
      await client.read(handle, [{ start, count }]);
    } catch {
      // A failed read leaves the previous rows on screen; the next scroll
      // or mutation asks again.
    } finally {
      inFlight.delete(id);
    }
  };

  /** Fold a reply into the store, unless it describes a past revision. */
  const apply = (update: TableUpdate) => {
    // Replies arrive in order, but a read issued before a mutation can
    // still land after the store has moved on. Anything older is stale.
    if (update.revision < revision) return;

    const moved = update.revision !== revision;
    revision = update.revision;
    rowCount = update.rowCount;
    totalRows = update.totalRows;

    for (const [col, added] of Object.entries(update.dictionaries)) {
      const mirror = mirrors.get(Number(col));
      if (mirror) mirror.push(...added);
    }

    // Whether anything a reader could see has actually changed. A reply
    // repeating a window already held at this revision is not a change,
    // and bumping the version for it would re-render, which would ask for
    // the window again: a loop that only ends when the frame does.
    let touched = moved;
    for (const window of update.windows) {
      const id = key(window.start, window.count);
      const held = cache.get(id);
      if (!held || held.revision !== update.revision) touched = true;
      cache.set(id, {
        start: window.start,
        count: window.count,
        revision: update.revision,
        value: makeView(schema, window.view, mirrors),
      });
    }

    // A revision that moved retires every window the reply did not carry.
    if (moved) {
      for (const [id, entry] of cache) {
        if (entry.revision !== revision) cache.delete(id);
      }
    }

    lastCallMs = client.lastCallMs;
    if (!touched) return;
    version++;
    for (const listener of listeners) listener();
  };

  const unsubscribeUpdates = client.onUpdate((forHandle, update) => {
    if (forHandle === handle) apply(update);
  });

  // Everything that touches the worker waits on this. It resolves once,
  // and every later await is free.
  const ready = pending.then(async (id) => {
    if (disposed) {
      void client.dropTable(id).catch(() => {});
      return;
    }
    handle = id;
    publishWindows();
    await client.read(id).catch(() => {});
  });

  const toColumns = (columns: ColumnsInput<S>) =>
    schema.names.map((name, col) => {
      const kind = schema.kinds[col] as ColumnKind;
      const values = columns[name] as ArrayLike<number> & readonly string[];
      return kind === "string"
        ? ({ kind, values: values as unknown as readonly string[] } as const)
        : ({ kind, values } as const);
    });

  const store: AsyncTableStore<S> = {
    schema,

    async insertRows(rows) {
      alive("insertRows");
      await ready;
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

      const first = await client.insertColumns(handle, columns);
      return rowIds(first, rows.length);
    },

    async insertColumns(columns) {
      alive("insertColumns");
      await ready;
      const payload = toColumns(columns);
      // Copied before transferring: the buffers are detached on this side,
      // and a caller's array going empty under them would be a nasty
      // surprise for an API that reads like a value.
      const owned = payload.map((column) =>
        column.kind === "string"
          ? column
          : ({
              kind: column.kind,
              values:
                column.kind === "f64"
                  ? Float64Array.from(column.values)
                  : Int32Array.from(column.values),
            } as const)
      );
      const length = owned[0] ? owned[0].values.length : 0;
      const first = await client.insertColumns(handle, owned);
      return rowIds(first, length);
    },

    async setCell(rowId, column, value) {
      alive("setCell");
      await ready;
      const col = schema.indexOf[column];
      if (col === undefined) {
        throw new Error(`use-wasm-state: no column named "${String(column)}"`);
      }
      await client.setCell(
        handle,
        rowId,
        col,
        schema.kinds[col] as ColumnKind,
        value as number | string
      );
    },

    async deleteRows(ids) {
      alive("deleteRows");
      await ready;
      await client.deleteRows(handle, ids);
    },

    async setQuery(next) {
      alive("setQuery");
      await ready;
      const normalized = normalizeQuery(next);
      const wire = toWireQuery(schema, normalized);
      await client.setQuery(handle, wire);
      query = normalized;
      version++;
      for (const listener of listeners) listener();
    },

    sortBy(column, direction) {
      return store.setQuery({ ...query, sort: direction ? [{ column, direction }] : [] });
    },
    filter(clauses) {
      return store.setQuery({ ...query, filters: clauses });
    },
    search(text) {
      return store.setQuery({ ...query, search: text });
    },
    clearQuery() {
      return store.setQuery({});
    },

    get version() {
      alive("version");
      return version;
    },
    get lastCallMs() {
      alive("lastCallMs");
      return lastCallMs;
    },
    get revision() {
      alive("revision");
      return revision;
    },
    get rowCount() {
      alive("rowCount");
      return rowCount;
    },
    get totalRows() {
      alive("totalRows");
      return totalRows;
    },
    get query() {
      alive("query");
      return query;
    },

    /**
     * The exact window if the worker has sent it at this revision, and the
     * closest one it has sent otherwise.
     *
     * Never null once anything has loaded, because a grid that blanks
     * while it scrolls is worse than a grid showing rows a few hundred
     * pixels off. The returned view carries its own start, so the caller
     * draws those rows where they really belong.
     */
    view(start: number, count: number) {
      alive("view");
      const exact = cache.get(key(start, count));
      if (exact && exact.revision === revision) return exact.value;

      // Not here yet: ask, and answer with the nearest thing meanwhile.
      if (handle !== -1)
        void client.read(handle, [{ start, count }]).catch(() => {
          // A failed read leaves the previous rows on screen; the next
          // mutation or scroll will ask again.
        });

      let best: CachedWindow<S> | null = null;
      let distance = Infinity;
      for (const entry of cache.values()) {
        const d = Math.abs(entry.start - start);
        if (d < distance) {
          best = entry;
          distance = d;
        }
      }
      return best?.value ?? makeView(schema, emptyView(schema.columns, start), mirrors);
    },

    /**
     * Read a window for certain, waiting for the worker rather than
     * answering with the nearest thing.
     */
    async readWindow(start: number, count: number) {
      alive("readWindow");
      await ready;
      await request(start, count);
      const entry = cache.get(key(start, count));
      return entry ? entry.value : store.view(start, count);
    },

    /**
     * Say that a window is on screen, so every reply refreshes it.
     *
     * Ref-counted and deduplicated: two components on the same window
     * register once, and the window is only retired when the last of them
     * has gone.
     */
    watch(start: number, count: number) {
      alive("watch");
      const id = key(start, count);
      const entry = wanted.get(id);
      if (entry) entry.refs++;
      else {
        wanted.set(id, { spec: { start, count }, refs: 1 });
        if (handle !== -1) {
          publishWindows();
          // Fetch it now rather than waiting for the next mutation.
          void request(start, count);
        }
      }

      return () => {
        const current = wanted.get(id);
        if (!current) return;
        if (--current.refs > 0) return;
        wanted.delete(id);
        cache.delete(id);
        publishWindows();
      };
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeUpdates();
      listeners.clear();
      cache.clear();
      wanted.clear();
      if (handle !== -1)
        void client.dropTable(handle).catch(() => {
          // The engine may already be gone; dropping a handle twice is not
          // worth surfacing.
        });
    },
  };

  return store;
}

/** A view of nothing, for the moment before the first reply lands. */
function emptyView(columns: readonly ColumnSpec[], start: number): DecodedView {
  return {
    start,
    ids: new Int32Array(0),
    columns: columns.map((column) => (column.type === 1 ? new Float64Array(0) : new Int32Array(0))),
  };
}
