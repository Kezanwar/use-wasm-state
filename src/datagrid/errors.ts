/**
 * The engine's status codes, as WasmStateErrors.
 *
 * The engine returns small negative integers rather than throwing. This is
 * where each one gets the stable name a caller switches on.
 */

import { WasmStateError, type WasmStateErrorCode } from "../core/errors";
import { Status, statusText } from "./abi";

const CODES: Record<number, WasmStateErrorCode> = {
  [Status.BadHandle]: "bad-handle",
  [Status.OutOfRange]: "out-of-range",
  [Status.RowDeleted]: "row-deleted",
  [Status.WrongType]: "wrong-type",
  [Status.RowCount]: "row-count",
  [Status.BadSchema]: "bad-schema",
  [Status.BadArgument]: "bad-argument",
};

/** The error for a status the engine returned. */
export function engineError(status: number, op: string): WasmStateError {
  return new WasmStateError(
    CODES[status] ?? "engine",
    status,
    op,
    `use-wasm-state: ${op} failed: ${statusText(status)}`
  );
}

/** Throw if `status` is negative; otherwise hand it straight back. */
export function check(status: number, op: string): number {
  if (status < 0) throw engineError(status, op);
  return status;
}
