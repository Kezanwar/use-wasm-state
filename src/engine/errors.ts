/**
 * The one error type this package throws.
 *
 * Internal exports live in ./abi; this is re-exported publicly, because a
 * consumer catching an error needs to be able to name it.
 */

import { Status, statusText, type StatusCode } from "./abi";

/** A stable string name per status, for code that switches on failures. */
export const ErrorCode = {
  [Status.BadHandle]: "bad-handle",
  [Status.OutOfRange]: "out-of-range",
  [Status.RowDeleted]: "row-deleted",
  [Status.WrongType]: "wrong-type",
  [Status.RowCount]: "row-count",
  [Status.BadSchema]: "bad-schema",
  [Status.BadArgument]: "bad-argument",
} as const satisfies Record<number, string>;

export type WasmStateErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode] | "disposed" | "engine";

/**
 * A failure that came back from the engine, or from calling into one that
 * is no longer usable.
 *
 * The engine returns small negative integers rather than throwing, because
 * a trap would take the whole module down and a grid asking for a row that
 * just got deleted is ordinary. This turns the ones a caller should not
 * ignore into something with a stack and a name.
 */
export class WasmStateError extends Error {
  /** A stable name, for switching on. */
  readonly code: WasmStateErrorCode;
  /** The raw status from the engine, or 0 when it never got that far. */
  readonly status: number;
  /** Which call failed, e.g. "setCell". */
  readonly op: string;

  constructor(code: WasmStateErrorCode, status: number, op: string, message?: string) {
    super(message ?? `use-wasm-state: ${op} failed: ${statusText(status)}`);
    this.name = "WasmStateError";
    this.code = code;
    this.status = status;
    this.op = op;
  }

  /** Build one from a status the engine returned. */
  static fromStatus(status: number, op: string): WasmStateError {
    const code = ErrorCode[status as keyof typeof ErrorCode] ?? "engine";
    return new WasmStateError(code, status, op);
  }

  /** Throw if `status` is negative; otherwise hand it straight back. */
  static check(status: number, op: string): number {
    if (status < 0) throw WasmStateError.fromStatus(status, op);
    return status;
  }
}

/** The error a disposed store or engine throws, for any call made on it. */
export function disposedError(op: string, what: string): WasmStateError {
  return new WasmStateError(
    "disposed",
    0,
    op,
    `use-wasm-state: ${op} was called after the ${what} was disposed`
  );
}

export type { StatusCode };
