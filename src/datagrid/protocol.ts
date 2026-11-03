/**
 * The datagrid's requests, inside the envelope every worker speaks (see
 * core/worker/protocol). The shapes are deliberately flat: everything
 * crossing a postMessage boundary has to be structured-cloneable, and
 * anything with a prototype stops being itself on the way over.
 *
 * The reply to a mutation is the interesting part. A worker that answered
 * only "done" would cost a second round trip to find out what changed, so
 * every mutation and query reply carries the new revision, the row count,
 * whatever the string dictionaries gained, and fresh rows for every window
 * the store says is on screen. One round trip per user action.
 *
 * Internal.
 */

import type { ColumnSpec, DecodedView, WireQuery } from "./abi";
import type { ColumnValues } from "./client";
import type { Body, Reply } from "../core/worker/protocol";

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

/** A request without its id, which is what a caller builds. */
export type RequestBody = Body<Request>;

/** A reply to a datagrid request: its update says what changed. */
export type GridReply = Reply<TableUpdate>;
