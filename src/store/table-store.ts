/**
 * TableStore: one table, framework-agnostic.
 *
 * Holds the handle, keeps a mirror of each string column's dictionary, and
 * caches the most recent viewport so React gets a stable snapshot. Knows
 * nothing about React, and nothing about whether the engine is on this
 * thread or in a worker.
 */

import type { ColumnKind, SyncEngineClient } from "../engine/client";
import { ColumnType } from "../engine/abi";
import { disposedError } from "../engine/errors";
import type { ColumnsInput, Row, SchemaSpec, TableSchema } from "./schema";

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

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/**
 * One window of a table.
 *
 * Columnar inside, because that is how it crossed the boundary and how a
 * grid wants to read it. `row()` and `rows()` build objects only when
 * something actually needs them.
 */
export interface TableView<S extends SchemaSpec> {
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

export interface TableStore<S extends SchemaSpec = SchemaSpec> {
  readonly schema: TableSchema<S>;

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

  /** Bumped by every mutation that changed something. */
  readonly revision: number;
  /** Live rows. */
  readonly rowCount: number;
  /** Rows ever inserted, tombstones included. */
  readonly totalRows: number;

  /**
   * Read a window.
   *
   * The same (revision, start, count) gives back the identical object, so
   * it can be a useSyncExternalStore snapshot.
   */
  view(start: number, count: number): TableView<S>;

  /** Called after any mutation that moved the revision. */
  subscribe(listener: () => void): () => void;

  /** Drop the table. Any later call throws. */
  dispose(): void;
}

interface CachedView<S extends SchemaSpec> {
  revision: number;
  start: number;
  count: number;
  value: TableView<S>;
}

export function createTableStore<S extends SchemaSpec>(
  client: SyncEngineClient,
  handle: number,
  schema: TableSchema<S>
): TableStore<S> {
  const listeners = new Set<() => void>();

  /**
   * One string[] per string column, kept in step with the engine's
   * append-only dictionary. Dictionaries only ever grow, so this is topped
   * up with dictSince(known) rather than refetched.
   */
  const mirrors = new Map<number, string[]>();
  for (let i = 0; i < schema.kinds.length; i++) {
    if (schema.kinds[i] === "string") mirrors.set(i, []);
  }

  let disposed = false;
  let revision = client.revisionSync(handle);
  let cache: CachedView<S> | null = null;

  const alive = (op: string) => {
    if (disposed) throw disposedError(op, "table");
  };

  /** Top up every string column's mirror. Cheap when nothing was added. */
  const syncDictionaries = () => {
    for (const [col, mirror] of mirrors) {
      const known = mirror.length;
      if (client.dictLenSync(handle, col) === known) continue;
      for (const value of client.dictSinceSync(handle, col, known)) mirror.push(value);
    }
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
    // The cache is keyed on the revision, so a changed revision retires it
    // without having to be cleared. Clearing anyway keeps the window data
    // from outliving the table it describes.
    cache = null;
    if (touchedStrings) syncDictionaries();
    for (const listener of listeners) listener();
  };

  syncDictionaries();

  const store: TableStore<S> = {
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

    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      cache = null;
      client.dropTableSync(handle);
    },
  };

  return store;
}

function makeView<S extends SchemaSpec>(
  schema: TableSchema<S>,
  decoded: { start: number; ids: Int32Array; columns: (Int32Array | Float64Array)[] },
  mirrors: Map<number, string[]>
): TableView<S> {
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
    get: get as TableView<S>["get"],
    row,
    rows: () => Array.from({ length }, (_, i) => row(i)),
  };
}

export { ColumnType };
