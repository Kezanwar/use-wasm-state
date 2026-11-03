import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { vi } from "vitest";
import { instantiateModule } from "../../src/core/wasm/loader";
import { unpack } from "../../src/core/wasm/memory";
import {
  ColumnType,
  decodeDict,
  decodeView,
  encodeQuery,
  encodeSchema,
  encodeStrings,
  type ColumnSpec,
  type DecodedView,
  type EngineExports,
  type WireQuery,
} from "../../src/datagrid/abi";
import { bytesIn, f64In, i32In, stringIn, u32In, withInput } from "../../src/core/wasm/input";

/**
 * Harness for driving the real datagrid.wasm from Node.
 *
 * Everything here does what src/datagrid/sync-client.ts does. In
 * particular it goes through withInput for every call that passes data in,
 * and never calls alloc or free: that is the memory model the engine is
 * built around, so the tests have to exercise it rather than a friendlier
 * path of their own.
 */

/** The URL serveEngine() answers. Pass it as a wasmUrl. */
export const ENGINE_URL = "https://engine.test/datagrid.wasm";
const ENGINE_PATH = resolve(process.cwd(), "src/datagrid/datagrid.wasm");

/**
 * Serve the committed engine over a stubbed fetch, so the module is loaded
 * through the package's own loader rather than around it. Node's fetch
 * cannot read a file: URL, and compiling the bytes directly here would leave
 * the loader untested against the thing it actually has to load.
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
/* Calls                                                               */
/* ------------------------------------------------------------------ */

export function createGrid(e: EngineExports, schema: readonly ColumnSpec[]): number {
  const bytes = encodeSchema(schema);
  return withInput(e, [bytesIn(bytes)], ([s]) => e.createGrid(s.ptr, s.len));
}

export type ColumnInput =
  | { type: typeof ColumnType.I32; values: ArrayLike<number> }
  | { type: typeof ColumnType.F64; values: ArrayLike<number> }
  | { type: typeof ColumnType.String; values: readonly string[] };

/**
 * Append rows: one descriptor per column, and a single insertColumns call.
 *
 * Every buffer lands in the input buffer in one withInput, which matters
 * more here than anywhere else. The descriptors hold offsets into the other
 * blocks, so if the buffer could grow between writing a column and writing
 * the descriptor that points at it, the descriptor would carry a stale
 * offset. Sizing everything up front is what makes that impossible.
 */
export function insertColumns(
  e: EngineExports,
  handle: number,
  columns: readonly ColumnInput[]
): number {
  const args = [];
  // Which block index holds each column's data, and its offsets if it has
  // any. Filled as the args are built, read once the blocks exist.
  const layout: Array<{ data: number; offsets: number; rows: number }> = [];

  for (const column of columns) {
    if (column.type === ColumnType.String) {
      const { blob, offsets } = encodeStrings(column.values);
      layout.push({ data: args.length, offsets: args.length + 1, rows: column.values.length });
      args.push(bytesIn(blob), u32In(offsets));
      continue;
    }
    layout.push({ data: args.length, offsets: -1, rows: column.values.length });
    args.push(column.type === ColumnType.F64 ? f64In(column.values) : i32In(column.values));
  }

  const descIndex = args.length;
  args.push(u32In(new Uint32Array(columns.length * 4)));

  return withInput(e, args, (blocks) => {
    const descs = new Uint32Array(e.memory.buffer, blocks[descIndex]!.ptr, columns.length * 4);
    columns.forEach((_column, i) => {
      const { data, offsets, rows } = layout[i]!;
      const d = blocks[data]!;
      descs.set([d.ptr, d.len, offsets === -1 ? 0 : blocks[offsets]!.ptr, rows], i * 4);
    });
    return e.insertColumns(handle, blocks[descIndex]!.ptr, columns.length);
  });
}

export function setQuery(e: EngineExports, handle: number, query: WireQuery): number {
  const bytes = encodeQuery(query);
  return withInput(e, [bytesIn(bytes)], ([q]) => e.setQuery(handle, q.ptr, q.len));
}

export function deleteRows(e: EngineExports, handle: number, ids: ArrayLike<number>): number {
  return withInput(e, [i32In(ids)], ([block]) => e.deleteRows(handle, block.ptr, block.len));
}

export function setCellString(
  e: EngineExports,
  handle: number,
  row: number,
  col: number,
  value: string
): number {
  return withInput(e, [stringIn(value)], ([text]) =>
    e.setCellString(handle, row, col, text.ptr, text.len)
  );
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

export function dictPacked(
  e: EngineExports,
  handle: number,
  col: number,
  from: number
): { ptr: number; len: number } | null {
  const packed = e.dictSince(handle, col, from);
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
  return decodeView(new Uint8Array(e.memory.buffer, window.ptr, window.len), schema);
}

/**
 * Read a dictionary delta. decodeDict builds the strings out of the
 * engine's buffer; nothing is freed, and the buffer is reused next call.
 */
export function readDictSince(
  e: EngineExports,
  handle: number,
  col: number,
  from: number
): string[] | null {
  const window = dictPacked(e, handle, col, from);
  if (!window) return null;
  return decodeDict(new Uint8Array(e.memory.buffer, window.ptr, window.len));
}
