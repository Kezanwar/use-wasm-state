/**
 * The JavaScript half of the engine's wire format.
 *
 * Every constant and layout here has a counterpart in engine/abi, and the
 * two agreeing is what test/abi.test.ts checks against the real
 * engine.wasm. Change one side and you have to change the other.
 *
 * Internal. Nothing here is exported from src/index.ts: it is the contract
 * between the store and the module, not something a consumer should hold.
 */

import type { WasmAllocator } from "../internal/wasm/memory";
import type { InputHost } from "./input";

/* ------------------------------------------------------------------ */
/* Status codes                                                        */
/* ------------------------------------------------------------------ */

/**
 * Mirrors engine/abi/status.go.
 *
 * Every export that can fail returns one of these as a negative int32,
 * which works because no export has a meaningful negative result: a handle,
 * a row id and a count are all non-negative.
 */
export const Status = {
  OK: 0,
  /** The handle was never issued, or the table has been dropped. */
  BadHandle: -1,
  /** A row id or column index outside the table. */
  OutOfRange: -2,
  /** The row exists but has been deleted. */
  RowDeleted: -3,
  /** The column holds a different type. */
  WrongType: -4,
  /** The columns of one insert disagree on how many rows they carry. */
  RowCount: -5,
  /** The schema bytes are malformed, empty, or name a column twice. */
  BadSchema: -6,
  /** A malformed call: short buffer, bad length, misaligned pointer. */
  BadArgument: -7,
} as const;

export type StatusCode = (typeof Status)[keyof typeof Status];

const STATUS_TEXT: Record<number, string> = {
  [Status.BadHandle]: "no such table (bad or dropped handle)",
  [Status.OutOfRange]: "row or column out of range",
  [Status.RowDeleted]: "row is deleted",
  [Status.WrongType]: "wrong column type",
  [Status.RowCount]: "columns have different lengths",
  [Status.BadSchema]: "malformed schema",
  [Status.BadArgument]: "bad argument",
};

/** Human-readable form of a negative status, for error messages. */
export function statusText(status: number): string {
  return STATUS_TEXT[status] ?? `unknown status ${status}`;
}

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

/** Mirrors the wire bytes in engine/abi/schema.go, not the Go enum. */
export const ColumnType = {
  I32: 0,
  F64: 1,
  String: 2,
} as const;

export type ColumnTypeCode = (typeof ColumnType)[keyof typeof ColumnType];

export interface ColumnSpec {
  name: string;
  type: ColumnTypeCode;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Encode a schema for createTable.
 *
 * Layout, packed and little-endian: u32 columnCount, then per column a u8
 * type, a u32 name byte length and the name's UTF-8 bytes.
 */
export function encodeSchema(columns: readonly ColumnSpec[]): Uint8Array {
  const names = columns.map((c) => encoder.encode(c.name));

  let size = 4;
  for (const name of names) size += 5 + name.byteLength;

  const bytes = new Uint8Array(size);
  const dv = new DataView(bytes.buffer);
  dv.setUint32(0, columns.length, true);

  let off = 4;
  for (let i = 0; i < columns.length; i++) {
    bytes[off] = columns[i]!.type;
    dv.setUint32(off + 1, names[i]!.byteLength, true);
    off += 5;
    bytes.set(names[i]!, off);
    off += names[i]!.byteLength;
  }
  return bytes;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/** u32 row count, u32 clamped start row. */
export const VIEW_HEADER_SIZE = 8;

const alignUp = (n: number) => (n + 7) & ~7;

/**
 * Where each section of a view buffer starts, mirroring ViewOffsets in
 * engine/abi/view.go: the row ids first, then one entry per column.
 *
 * Every section is 8-byte aligned so a Float64Array can be mapped straight
 * onto an f64 column. That constructor throws on a misaligned offset, which
 * is why the padding exists rather than being an optimisation.
 */
export function viewOffsets(
  schema: readonly ColumnSpec[],
  n: number
): { offsets: number[]; size: number } {
  const offsets: number[] = [VIEW_HEADER_SIZE];
  let off = VIEW_HEADER_SIZE + n * 4;

  for (const column of schema) {
    off = alignUp(off);
    offsets.push(off);
    off += column.type === ColumnType.F64 ? n * 8 : n * 4;
  }
  return { offsets, size: off };
}

export interface DecodedView {
  /**
   * Where the window actually begins, after clamping.
   *
   * Not necessarily the start that was asked for: a grid mid-scroll asks
   * for rows that have just stopped existing. Line the rows up against
   * this, not against the request.
   */
  start: number;
  /** Row ids, in display order. React's keys, and what edits take. */
  ids: Int32Array;
  /**
   * One entry per schema column. A string column yields its dictionary
   * ids as an Int32Array; resolve them against the mirror built from
   * {@link decodeDict}.
   */
  columns: (Int32Array | Float64Array)[];
}

/**
 * Read a view buffer.
 *
 * Everything returned is a copy. The engine's view buffer is reused by the
 * next view call, so a typed array mapped onto it would silently change
 * under React between renders. Copying 50 rows is cheap; the bug is not.
 */
export function decodeView(bytes: Uint8Array, schema: readonly ColumnSpec[]): DecodedView {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(0, true);
  const start = dv.getUint32(4, true);
  const { offsets } = viewOffsets(schema, n);

  const ids = readI32(bytes, offsets[0]!, n);
  const columns = schema.map((column, i) =>
    column.type === ColumnType.F64
      ? readF64(bytes, offsets[i + 1]!, n)
      : readI32(bytes, offsets[i + 1]!, n)
  );

  return { start, ids, columns };
}

/**
 * Map a typed array onto a section and copy it out.
 *
 * The aligned path is the one that runs: the engine guarantees the buffer
 * starts on an 8-byte boundary and pads every section. The fallback copies
 * the bytes first, which re-bases them at offset zero, and exists so a
 * caller that handed us a misaligned slice gets a wrong-looking number
 * rather than a thrown constructor.
 */
function readI32(bytes: Uint8Array, off: number, n: number): Int32Array {
  const start = bytes.byteOffset + off;
  if (start % 4 === 0) return new Int32Array(bytes.buffer, start, n).slice();
  return new Int32Array(sliceBytes(bytes, off, n * 4).buffer);
}

function readF64(bytes: Uint8Array, off: number, n: number): Float64Array {
  const start = bytes.byteOffset + off;
  if (start % 8 === 0) return new Float64Array(bytes.buffer, start, n).slice();
  return new Float64Array(sliceBytes(bytes, off, n * 8).buffer);
}

function sliceBytes(bytes: Uint8Array, off: number, length: number): Uint8Array {
  return bytes.slice(off, off + length);
}

/* ------------------------------------------------------------------ */
/* Strings and dictionaries                                            */
/* ------------------------------------------------------------------ */

/**
 * Pack strings the way insertColumns and dictSince both carry them: one
 * UTF-8 blob plus count+1 byte offsets into it, so row i is
 * blob[offsets[i]:offsets[i+1]].
 *
 * One blob rather than a pointer per row: 200k rows cross as two buffers
 * instead of 200k, and the engine walks them once.
 */
export function encodeStrings(values: readonly string[]): {
  blob: Uint8Array;
  offsets: Uint32Array;
} {
  const count = values.length;
  const offsets = new Uint32Array(count + 1);

  // Guess the blob at one byte per character, which is exact for the ASCII
  // this is nearly always used on, plus headroom so the common case never
  // regrows.
  let guess = 16;
  for (let i = 0; i < count; i++) guess += values[i]!.length;
  let blob = new Uint8Array(guess + (guess >> 1));
  let at = 0;

  for (let i = 0; i < count; i++) {
    const text = values[i]!;
    const length = text.length;

    // Three bytes per UTF-16 unit is the worst a non-surrogate can encode
    // to, and a surrogate pair is two units for four bytes, so this covers
    // everything.
    if (at + length * 3 > blob.length) {
      const grown = new Uint8Array(Math.max(blob.length * 2, at + length * 3));
      grown.set(blob.subarray(0, at));
      blob = grown;
    }

    // The fast path: copy char codes straight in. Encoding 200k short
    // ASCII strings through TextEncoder.encode means 200k Uint8Arrays the
    // collector then has to walk, and it is the dominant cost of a bulk
    // insert.
    let ascii = true;
    for (let c = 0; c < length; c++) {
      const code = text.charCodeAt(c);
      if (code > 127) {
        ascii = false;
        break;
      }
      blob[at + c] = code;
    }

    if (ascii) {
      at += length;
    } else {
      // Anything else goes through the encoder, writing in place. The
      // subarray is the only allocation on this path, and only for strings
      // that actually need it.
      at += encoder.encodeInto(text, blob.subarray(at)).written;
    }
    offsets[i + 1] = at;
  }

  // A view, not a copy: withInput writes it into the engine's input buffer
  // straight from here.
  return { blob: blob.subarray(0, at), offsets };
}

/**
 * Read a dictSince buffer: u32 count, count+1 u32 offsets, then the blob.
 *
 * Dictionaries are append-only, so this is always a delta to push onto the
 * end of a mirror, never a replacement for one.
 *
 * The buffer belongs to the engine and the next dictSince call overwrites
 * it, so the strings are decoded out of it here and nothing is held. Never
 * free it.
 */
export function decodeDict(bytes: Uint8Array): string[] {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = dv.getUint32(0, true);
  const blob = 4 + (count + 1) * 4;

  const out: string[] = new Array(count);
  for (let i = 0; i < count; i++) {
    const from = dv.getUint32(4 + i * 4, true);
    const to = dv.getUint32(4 + (i + 1) * 4, true);
    out[i] = decoder.decode(bytes.subarray(blob + from, blob + to));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

/** Mirrors Op in engine/table/query.go. The numbers are the wire format. */
export const FilterOp = {
  eq: 0,
  ne: 1,
  lt: 2,
  le: 3,
  gt: 4,
  ge: 5,
  between: 6,
  in: 7,
  contains: 8,
} as const;

export type FilterOpName = keyof typeof FilterOp;

/** One filter, flattened the way the wire format carries it. */
export interface WireFilter {
  col: number;
  op: number;
  number: number;
  upper: number;
  text: string;
  list: readonly string[];
}

export interface WireQuery {
  sort: readonly { col: number; desc: boolean }[];
  filters: readonly WireFilter[];
  search: string;
}

/**
 * Encode a query for setQuery, mirroring DecodeQuery in engine/abi.
 *
 * Everything is length-prefixed and little-endian, and the whole query goes
 * in one call: applying half of one would show the wrong rows. An empty
 * query is three zero words and restores id order.
 */
export function encodeQuery(query: WireQuery): Uint8Array {
  const parts: Uint8Array[] = [];
  const strings = new Map<string, Uint8Array>();
  const utf8 = (text: string) => {
    let bytes = strings.get(text);
    if (!bytes) {
      bytes = encoder.encode(text);
      strings.set(text, bytes);
    }
    return bytes;
  };

  let size = 0;
  const push = (bytes: Uint8Array) => {
    parts.push(bytes);
    size += bytes.byteLength;
  };
  const u32 = (value: number) => {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    push(bytes);
  };
  const f64 = (value: number) => {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    push(bytes);
  };
  const str = (text: string) => {
    const bytes = utf8(text);
    u32(bytes.byteLength);
    push(bytes);
  };

  u32(query.sort.length);
  for (const key of query.sort) {
    u32(key.col);
    push(Uint8Array.of(key.desc ? 1 : 0));
  }

  u32(query.filters.length);
  for (const filter of query.filters) {
    u32(filter.col);
    push(Uint8Array.of(filter.op));
    f64(filter.number);
    f64(filter.upper);
    str(filter.text);
    u32(filter.list.length);
    for (const item of filter.list) str(item);
  }

  str(query.search);

  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.byteLength;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* The module's exports                                                */
/* ------------------------------------------------------------------ */

/**
 * Every export of engine.wasm, matching main.go one for one.
 *
 * Integer results that can fail carry a negative {@link Status} instead of
 * throwing: a trap would take the whole module down, and a grid asking for
 * a row that just got deleted is ordinary, not exceptional.
 */
export interface EngineExports extends WasmAllocator, InputHost {
  /**
   * The engine's own argument buffer, at least minBytes and 8-byte
   * aligned. Returns 0 for a non-positive size.
   *
   * This is how arguments get in; see withInput in ./input. Contents live
   * until the next call, growing moves it, and JS never frees it.
   */
  inputBuffer(minBytes: number): number;

  /**
   * Reserve `size` bytes with a lifetime of its own, 8-byte aligned.
   *
   * Still exported for callers that genuinely need that, but nothing in
   * this package uses it per operation: on the Go heap under a collector
   * the engine is trying to keep idle, inputBuffer is the path.
   */
  alloc(size: number): number;
  /** Release a block from alloc. Never pass it a view or input pointer. */
  free(ptr: number): void;

  /** Returns a handle, or a negative status. */
  createTable(schemaPtr: number, schemaLen: number): number;
  dropTable(handle: number): number;

  /**
   * Append rows. `descPtr` points at `colCount` descriptors, one per column
   * in schema order, each four u32s: dataPtr, dataLen, offsetsPtr, rowCount.
   *
   * Returns the first row id appended, or a negative status. Atomic: a
   * rejected insert leaves the table untouched.
   */
  insertColumns(handle: number, descPtr: number, colCount: number): number;

  setCellI32(handle: number, row: number, col: number, value: number): number;
  setCellF64(handle: number, row: number, col: number, value: number): number;
  setCellString(handle: number, row: number, col: number, ptr: number, len: number): number;
  deleteRows(handle: number, idsPtr: number, count: number): number;

  /**
   * Replace the sort, filters and search in one call. See encodeQuery for
   * the layout. A rejected query leaves the previous one in place.
   */
  setQuery(handle: number, ptr: number, len: number): number;

  /** Read with `>>> 0`: it is a uint32 counter that wraps. */
  revision(handle: number): number;
  rowCount(handle: number): number;
  totalRows(handle: number): number;
  dictLen(handle: number, col: number): number;

  /**
   * Packed (ptr << 32 | len) into a buffer the engine owns and reuses.
   * Zero on failure. Copy out of it before the next view call, and never
   * free it.
   */
  view(handle: number, start: number, count: number): bigint;

  /**
   * Packed (ptr << 32 | len) into a buffer the engine owns and reuses,
   * holding the dictionary entries added since `from`. Zero on failure.
   * Copy out of it before the next dictSince call, and never free it.
   */
  dictSince(handle: number, col: number, from: number): bigint;
}

/** Every export this package requires of a module, for an audit or a test. */
export const ENGINE_EXPORTS = [
  "inputBuffer",
  "alloc",
  "free",
  "createTable",
  "dropTable",
  "insertColumns",
  "setCellI32",
  "setCellF64",
  "setCellString",
  "deleteRows",
  "setQuery",
  "revision",
  "rowCount",
  "totalRows",
  "dictLen",
  "view",
  "dictSince",
] as const;
