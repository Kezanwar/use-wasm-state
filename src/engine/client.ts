/**
 * What a store needs of an engine, independent of where that engine runs.
 *
 * Two transports will implement this: SyncClient, which calls the module on
 * the main thread, and WorkerClient (build step 8), which does the same
 * thing over postMessage. Everything returns a Promise so the store is
 * written once and the difference stays below it.
 *
 * The sync client additionally offers the same reads synchronously, because
 * on the main thread a viewport can be read during render and going through
 * a microtask would cost a frame. See SyncEngineClient.
 *
 * Internal. Not exported from src/index.ts.
 */

import type { ColumnSpec, DecodedView, WireQuery } from "./abi";

/** The three things a column can hold. Mirrors the wire types in ./abi. */
export type ColumnKind = "i32" | "f64" | "string";

/** One column's worth of rows, in whichever form the caller already has. */
export type ColumnValues =
  | { kind: "i32"; values: ArrayLike<number> }
  | { kind: "f64"; values: ArrayLike<number> }
  | { kind: "string"; values: readonly string[] };

/** A cell value, matching its column's type. */
export type CellValue = number | string;

export interface EngineClient {
  /** Create a table and return its handle. */
  createTable(schema: readonly ColumnSpec[]): Promise<number>;
  dropTable(handle: number): Promise<void>;

  /** Append rows, one entry per column in schema order. Returns the first row id. */
  insertColumns(handle: number, columns: readonly ColumnValues[]): Promise<number>;

  /**
   * Write one cell.
   *
   * `kind` comes from the schema rather than from the value, because 1 is
   * a valid i32 and a valid f64 and guessing from the value would
   * silently truncate a float column. The engine checks it too.
   */
  setCell(
    handle: number,
    rowId: number,
    col: number,
    kind: ColumnKind,
    value: CellValue
  ): Promise<void>;
  deleteRows(handle: number, rowIds: ArrayLike<number>): Promise<void>;

  /**
   * Replace the sort, filters and search in one call.
   *
   * One call because it is one thing: a half-applied query would show the
   * wrong rows. A rejected query leaves the previous one in place.
   */
  setQuery(handle: number, query: WireQuery): Promise<void>;

  /** Read one window. The schema is needed to decode the columns. */
  view(
    handle: number,
    start: number,
    count: number,
    schema: readonly ColumnSpec[]
  ): Promise<DecodedView>;
  /** Dictionary entries added at or after `from`. */
  dictSince(handle: number, col: number, from: number): Promise<string[]>;

  revision(handle: number): Promise<number>;
  rowCount(handle: number): Promise<number>;
  totalRows(handle: number): Promise<number>;

  /** Release the client. Later calls throw. */
  dispose(): void;
}

/**
 * The main-thread client, which can also answer reads without a microtask.
 *
 * A store in sync mode reads its viewport during render, so every read has
 * a *Sync twin. In worker mode those are impossible and the store caches
 * what the last mutation sent back instead; that is why they live here and
 * not on EngineClient.
 */
export interface SyncEngineClient extends EngineClient {
  readonly mode: "sync";

  createTableSync(schema: readonly ColumnSpec[]): number;
  dropTableSync(handle: number): void;
  insertColumnsSync(handle: number, columns: readonly ColumnValues[]): number;
  setCellSync(handle: number, rowId: number, col: number, kind: ColumnKind, value: CellValue): void;
  deleteRowsSync(handle: number, rowIds: ArrayLike<number>): void;
  setQuerySync(handle: number, query: WireQuery): void;

  viewSync(
    handle: number,
    start: number,
    count: number,
    schema: readonly ColumnSpec[]
  ): DecodedView;
  dictSinceSync(handle: number, col: number, from: number): string[];
  revisionSync(handle: number): number;
  rowCountSync(handle: number): number;
  totalRowsSync(handle: number): number;
  dictLenSync(handle: number, col: number): number;
}
