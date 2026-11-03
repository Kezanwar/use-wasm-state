/**
 * The one error type this package throws, shared by every state pattern.
 *
 * Each entry point is its own self-contained bundle, so an app importing
 * the root and a pattern's entry loads two copies of this class.
 * `instanceof` would then fail across them, which is exactly the check a
 * consumer writes. A global brand fixes that: every copy recognises an
 * instance of any other.
 */

const BRAND = Symbol.for("use-wasm-state/error");

/** A stable name per failure, for code that switches on them. */
export type WasmStateErrorCode =
  /** A handle that names no live instance in the engine. */
  | "bad-handle"
  /** A row or column index outside the data. */
  | "out-of-range"
  /** A write to a row that has been deleted. */
  | "row-deleted"
  /** A value of the wrong type for its column. */
  | "wrong-type"
  /** Columns of different lengths in one insert. */
  | "row-count"
  /** A schema the engine could not read. */
  | "bad-schema"
  /** Anything else the engine refused as malformed. */
  | "bad-argument"
  /** The instance or engine was disposed before this call. */
  | "disposed"
  /** Two different definitions were given the same key in one provider. */
  | "schema_mismatch"
  /** A shared definition was used with no matching provider above it. */
  | "no_provider"
  /** Anything the engine reported that has no name yet. */
  | "engine";

/**
 * A failure that came back from an engine, or from calling into one that
 * is no longer usable.
 *
 * Engines return small negative integers rather than trapping, because a
 * trap takes the whole module down and asking for a row that was just
 * deleted is ordinary. This turns the ones a caller should not ignore
 * into something with a stack and a name.
 */
export class WasmStateError extends Error {
  /** A stable name, for switching on. */
  readonly code: WasmStateErrorCode;
  /** The raw status from the engine, or 0 when it never got that far. */
  readonly status: number;
  /** Which call failed, e.g. "setCell". */
  readonly op: string;

  constructor(code: WasmStateErrorCode, status: number, op: string, message: string) {
    super(message);
    this.name = "WasmStateError";
    this.code = code;
    this.status = status;
    this.op = op;
    (this as Record<symbol, unknown>)[BRAND] = true;
  }

  static [Symbol.hasInstance](value: unknown): boolean {
    return (
      typeof value === "object" &&
      value !== null &&
      (value as Record<symbol, unknown>)[BRAND] === true
    );
  }
}

/** The error a disposed instance or engine throws, for any call made on it. */
export function disposedError(op: string, what: string): WasmStateError {
  return new WasmStateError(
    "disposed",
    0,
    op,
    `use-wasm-state: ${op} was called after the ${what} was disposed`
  );
}

/** Anything caught, as an Error a status can carry. */
export function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}
