/**
 * What the main thread and the worker say to each other.
 *
 * One request, one reply, matched by id and answered in order. The shape is
 * deliberately flat: everything crossing a postMessage boundary has to be
 * structured-cloneable, and anything with a prototype stops being itself on
 * the way over.
 *
 * The reply to a mutation is the interesting part. A worker that answered
 * only "done" would cost a second round trip to find out what changed, so
 * every mutation and query reply carries the new revision, the row count,
 * whatever the string dictionaries gained, and fresh rows for every window
 * the store says is on screen. One round trip per user action.
 *
 * Internal. Not exported from src/index.ts.
 */

import type { ColumnSpec, DecodedView } from "./abi";
import type { ColumnValues } from "./client";
import type { WireQuery } from "./abi";

/** A window the store wants kept fresh. */
export interface WindowSpec {
  start: number;
  count: number;
}

/** One window's rows, as they crossed from the worker. */
export interface WindowData {
  start: number;
  count: number;
  /** The clamped start the engine actually gave, which may differ. */
  view: DecodedView;
}

/** What changed, sent back with every mutation and query. */
export interface TableUpdate {
  revision: number;
  rowCount: number;
  totalRows: number;
  /** Per string column index, the entries added since the store last knew. */
  dictionaries: Record<number, string[]>;
  /** Fresh rows for every window the store registered. */
  windows: WindowData[];
}

export type Request =
  | { id: number; op: "open"; url: string; cache: boolean }
  | { id: number; op: "createTable"; schema: readonly ColumnSpec[] }
  | { id: number; op: "dropTable"; handle: number }
  | {
      id: number;
      op: "insertColumns";
      handle: number;
      columns: readonly ColumnValues[];
      windows: readonly WindowSpec[];
    }
  | {
      id: number;
      op: "setCell";
      handle: number;
      rowId: number;
      col: number;
      kind: "i32" | "f64" | "string";
      value: number | string;
      windows: readonly WindowSpec[];
    }
  | {
      id: number;
      op: "deleteRows";
      handle: number;
      rowIds: Int32Array;
      windows: readonly WindowSpec[];
    }
  | {
      id: number;
      op: "setQuery";
      handle: number;
      query: WireQuery;
      windows: readonly WindowSpec[];
    }
  | { id: number; op: "read"; handle: number; windows: readonly WindowSpec[] };

/**
 * A request without its id, which is what a caller builds.
 *
 * Omit<Request, "id"> would collapse the union to the keys every member
 * shares, so it distributes over the members instead.
 */
export type RequestBody = Request extends infer R
  ? R extends Request
    ? Omit<R, "id">
    : never
  : never;

export type Reply =
  | { id: number; ok: true; result?: unknown; update?: TableUpdate }
  | {
      id: number;
      ok: false;
      error: { code: string; status: number; op: string; message: string };
    };

/** The worker needs a schema per table to decode views; it keeps its own. */
export interface WorkerTable {
  handle: number;
  schema: readonly ColumnSpec[];
  /** How many dictionary entries the main thread already has, per column. */
  known: Map<number, number>;
}
