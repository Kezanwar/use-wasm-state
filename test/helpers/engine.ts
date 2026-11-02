import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";
import { instantiateModule } from "../../src/internal/wasm/loader";
import { bytesVal, unpack } from "../../src/internal/wasm/memory";
import {
  ColumnType,
  decodeDict,
  decodeView,
  encodeSchema,
  encodeStrings,
  type ColumnSpec,
  type DecodedView,
  type EngineExports,
} from "../../src/engine/abi";

/**
 * Harness for driving the real engine.wasm from Node.
 *
 * Everything here does what src/engine/sync-client.ts will do in build step
 * 5: allocate, write, call, read back, free. Keeping it in the tests first
 * means the client is written against an ABI that has already been proven,
 * rather than the two being debugged at once.
 */

const ENGINE_URL = "https://engine.test/engine.wasm";
const ENGINE_PATH = resolve(process.cwd(), "src/wasm/engine.wasm");

/**
 * Serve the committed engine over a stubbed fetch, so the module is loaded
 * through the copied loader rather than around it. Node's fetch cannot read
 * a file: URL, and compiling the bytes directly here would leave the loader
 * untested against the thing it actually has to load.
 */
export function serveEngine(): void {
  vi.stubGlobal("fetch", async () => {
    return new Response(readFileSync(ENGINE_PATH), {
      headers: { "content-type": "application/wasm" },
    });
  });
}

/** A fresh instance, with its own linear memory. One compile is shared. */
export async function newEngine(): Promise<EngineExports> {
  const instance = await instantiateModule(ENGINE_URL);
  return instance.exports as unknown as EngineExports;
}

export const ENGINE_BYTE_SIZE = readFileSync(ENGINE_PATH).byteLength;

/* ------------------------------------------------------------------ */
/* Memory                                                              */
/* ------------------------------------------------------------------ */

/**
 * Copy bytes into a fresh wasm allocation and return the offset.
 *
 * The view over memory.buffer is taken *after* alloc, every time. A large
 * alloc can grow linear memory, and a grow detaches every view taken before
 * it; caching one anywhere is the bug this whole layer has to avoid.
 */
export function writeBytes(e: EngineExports, data: Uint8Array): number {
  if (data.byteLength === 0) return 0;
  const ptr = e.alloc(data.byteLength);
  new Uint8Array(e.memory.buffer).set(data, ptr);
  return ptr;
}

const asBytes = (a: Int32Array | Float64Array | Uint32Array) =>
  new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

/* ------------------------------------------------------------------ */
/* Calls                                                               */
/* ------------------------------------------------------------------ */

export function createTable(e: EngineExports, schema: readonly ColumnSpec[]): number {
  const bytes = encodeSchema(schema);
  const ptr = writeBytes(e, bytes);
  try {
    return e.createTable(ptr, bytes.byteLength);
  } finally {
    e.free(ptr);
  }
}

export type ColumnInput =
  | { type: typeof ColumnType.I32; values: ArrayLike<number> }
  | { type: typeof ColumnType.F64; values: ArrayLike<number> }
  | { type: typeof ColumnType.String; values: readonly string[] };

/**
 * Build one descriptor per column and make a single insertColumns call.
 *
 * JS owns every buffer here and frees all of them on the way out, including
 * when the call fails: the engine copies what it keeps.
 */
export function insertColumns(
  e: EngineExports,
  handle: number,
  columns: readonly ColumnInput[]
): number {
  const owned: number[] = [];
  const descs = new Uint32Array(columns.length * 4);

  const keep = (ptr: number) => {
    if (ptr !== 0) owned.push(ptr);
    return ptr;
  };

  try {
    columns.forEach((column, i) => {
      if (column.type === ColumnType.String) {
        const { blob, offsets } = encodeStrings(column.values);
        const blobPtr = keep(writeBytes(e, blob));
        const offsetsPtr = keep(writeBytes(e, asBytes(offsets)));
        descs.set([blobPtr, blob.byteLength, offsetsPtr, column.values.length], i * 4);
        return;
      }

      const typed =
        column.type === ColumnType.F64
          ? Float64Array.from(column.values)
          : Int32Array.from(column.values);
      const ptr = keep(writeBytes(e, asBytes(typed)));
      descs.set([ptr, typed.length, 0, typed.length], i * 4);
    });

    const descPtr = keep(writeBytes(e, asBytes(descs)));
    return e.insertColumns(handle, descPtr, columns.length);
  } finally {
    for (const ptr of owned) e.free(ptr);
  }
}

export function deleteRows(e: EngineExports, handle: number, ids: ArrayLike<number>): number {
  const typed = Int32Array.from(ids);
  const ptr = writeBytes(e, asBytes(typed));
  try {
    return e.deleteRows(handle, ptr, typed.length);
  } finally {
    if (ptr !== 0) e.free(ptr);
  }
}

export function setCellString(
  e: EngineExports,
  handle: number,
  row: number,
  col: number,
  value: string
): number {
  const bytes = new TextEncoder().encode(value);
  const ptr = writeBytes(e, bytes);
  try {
    return e.setCellString(handle, row, col, ptr, bytes.byteLength);
  } finally {
    if (ptr !== 0) e.free(ptr);
  }
}

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** The raw packed return, for tests that care about the pointer itself. */
export function viewPacked(
  e: EngineExports,
  handle: number,
  start: number,
  count: number
): { ptr: number; len: number } | null {
  const packed = e.view(handle, start, count);
  return packed === 0n ? null : unpack(packed);
}

/**
 * Read a view and copy everything out of it.
 *
 * The view buffer belongs to the engine and the next view call overwrites
 * it, so nothing may be held: decodeView copies, and this never frees.
 */
export function readView(
  e: EngineExports,
  handle: number,
  start: number,
  count: number,
  schema: readonly ColumnSpec[]
): DecodedView | null {
  const window = viewPacked(e, handle, start, count);
  if (!window) return null;
  const bytes = new Uint8Array(e.memory.buffer, window.ptr, window.len);
  return decodeView(bytes, schema);
}

/** Read a dictionary delta. bytesVal copies it out and frees it. */
export function readDictSince(
  e: EngineExports,
  handle: number,
  col: number,
  from: number
): string[] | null {
  const packed = e.dictSince(handle, col, from);
  if (packed === 0n) return null;
  const bytes = bytesVal(e, packed);
  return bytes === null ? null : decodeDict(bytes);
}
