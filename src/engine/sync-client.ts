/**
 * EngineClient over a module running on this thread.
 *
 * Everything here is really synchronous; the Promise-returning half exists
 * so a store can be written against one interface and have the worker
 * client (build step 8) slot in underneath. The *Sync twins are what the
 * sync-mode store actually calls, because a viewport read happens during
 * render.
 *
 * Internal. Not exported from src/index.ts.
 */

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
} from "./abi";
import type { CellValue, ColumnKind, ColumnValues, SyncEngineClient } from "./client";
import { disposedError, WasmStateError } from "./errors";
import { unpack } from "../internal/wasm/memory";
import { bytesIn, f64In, i32In, stringIn, u32In, withInput, type InputArg } from "./input";

export class SyncClient implements SyncEngineClient {
  readonly mode = "sync" as const;

  #exports: EngineExports | null;

  /**
   * How long the last call spent in the engine.
   *
   * Set here rather than measured by a caller, so what a status bar shows
   * is the engine's time and never React's. In worker mode the same
   * number is the round trip; see WorkerClient.
   */
  lastCallMs = 0;

  constructor(exports: EngineExports) {
    this.#exports = exports;
  }

  /** Run a call and record what it cost. */
  #timed<T>(run: () => T): T {
    const started = performance.now();
    try {
      return run();
    } finally {
      this.lastCallMs = performance.now() - started;
    }
  }

  #e(op: string): EngineExports {
    if (!this.#exports) throw disposedError(op, "engine");
    return this.#exports;
  }

  dispose(): void {
    // Nothing to release: the module's memory goes when the instance is
    // dropped. Clearing the reference is what makes later calls say so
    // rather than read a table that no longer means anything.
    this.#exports = null;
  }

  /* ---------------------------------------------------------------- */
  /* Tables                                                            */
  /* ---------------------------------------------------------------- */

  createTableSync(schema: readonly ColumnSpec[]): number {
    const e = this.#e("createTable");
    const bytes = encodeSchema(schema);
    return this.#timed(() =>
      WasmStateError.check(
        withInput(e, [bytesIn(bytes)], ([s]) => e.createTable(s.ptr, s.len)),
        "createTable"
      )
    );
  }

  dropTableSync(handle: number): void {
    const e = this.#e("dropTable");
    WasmStateError.check(e.dropTable(handle), "dropTable");
  }

  /**
   * Append rows in one call.
   *
   * Every buffer goes into the engine's input buffer through a single
   * withInput, which matters more here than anywhere else: the descriptors
   * hold offsets into the other blocks, so a buffer that could grow between
   * writing a column and writing the descriptor pointing at it would leave
   * that descriptor stale.
   */
  insertColumnsSync(handle: number, columns: readonly ColumnValues[]): number {
    const e = this.#e("insertColumns");

    const args: InputArg[] = [];
    const layout: Array<{ data: number; offsets: number; rows: number }> = [];

    for (const column of columns) {
      if (column.kind === "string") {
        const { blob, offsets } = encodeStrings(column.values);
        layout.push({ data: args.length, offsets: args.length + 1, rows: column.values.length });
        args.push(bytesIn(blob), u32In(offsets));
        continue;
      }
      layout.push({ data: args.length, offsets: -1, rows: column.values.length });
      args.push(column.kind === "f64" ? f64In(column.values) : i32In(column.values));
    }

    const descIndex = args.length;
    args.push(u32In(new Uint32Array(columns.length * 4)));

    const status = this.#timed(() =>
      withInput(e, args, (blocks) => {
        const descs = new Uint32Array(e.memory.buffer, blocks[descIndex]!.ptr, columns.length * 4);
        for (let i = 0; i < columns.length; i++) {
          const { data, offsets, rows } = layout[i]!;
          const d = blocks[data]!;
          descs.set([d.ptr, d.len, offsets === -1 ? 0 : blocks[offsets]!.ptr, rows], i * 4);
        }
        return e.insertColumns(handle, blocks[descIndex]!.ptr, columns.length);
      })
    );

    return WasmStateError.check(status, "insertColumns");
  }

  setCellSync(
    handle: number,
    rowId: number,
    col: number,
    kind: ColumnKind,
    value: CellValue
  ): void {
    const e = this.#e("setCell");

    // Which setter to use comes from the schema, never from the value:
    // 1 is a valid i32 and a valid f64, and guessing would truncate a
    // float column on its first whole number.
    const status = this.#timed(() =>
      kind === "string"
        ? withInput(e, [stringIn(String(value))], ([text]) =>
            e.setCellString(handle, rowId, col, text.ptr, text.len)
          )
        : kind === "f64"
          ? e.setCellF64(handle, rowId, col, value as number)
          : e.setCellI32(handle, rowId, col, value as number)
    );

    WasmStateError.check(status, "setCell");
  }

  deleteRowsSync(handle: number, rowIds: ArrayLike<number>): void {
    const e = this.#e("deleteRows");
    WasmStateError.check(
      this.#timed(() =>
        withInput(e, [i32In(rowIds)], ([ids]) => e.deleteRows(handle, ids.ptr, ids.len))
      ),
      "deleteRows"
    );
  }

  setQuerySync(handle: number, query: WireQuery): void {
    const e = this.#e("setQuery");
    const bytes = encodeQuery(query);
    WasmStateError.check(
      this.#timed(() => withInput(e, [bytesIn(bytes)], ([q]) => e.setQuery(handle, q.ptr, q.len))),
      "setQuery"
    );
  }

  /* ---------------------------------------------------------------- */
  /* Reads                                                             */
  /* ---------------------------------------------------------------- */

  /**
   * Read one window.
   *
   * The engine's view buffer is overwritten by the next view call, so
   * decodeView copies everything out before this returns. Nothing here is
   * freed; the buffer belongs to the engine.
   */
  viewSync(
    handle: number,
    start: number,
    count: number,
    schema: readonly ColumnSpec[]
  ): DecodedView {
    const e = this.#e("view");
    const packed = e.view(handle, start, count);
    if (packed === 0n) throw WasmStateError.fromStatus(-1, "view");
    const { ptr, len } = unpack(packed);
    return decodeView(new Uint8Array(e.memory.buffer, ptr, len), schema);
  }

  dictSinceSync(handle: number, col: number, from: number): string[] {
    const e = this.#e("dictSince");
    const packed = e.dictSince(handle, col, from);
    if (packed === 0n) throw WasmStateError.fromStatus(-1, "dictSince");
    const { ptr, len } = unpack(packed);
    return decodeDict(new Uint8Array(e.memory.buffer, ptr, len));
  }

  revisionSync(handle: number): number {
    const e = this.#e("revision");
    // Read unsigned: the engine keeps it inside 31 bits so it can never
    // read as a status, but >>> 0 is what the ABI documents.
    return WasmStateError.check(e.revision(handle), "revision") >>> 0;
  }

  rowCountSync(handle: number): number {
    const e = this.#e("rowCount");
    return WasmStateError.check(e.rowCount(handle), "rowCount");
  }

  totalRowsSync(handle: number): number {
    const e = this.#e("totalRows");
    return WasmStateError.check(e.totalRows(handle), "totalRows");
  }

  dictLenSync(handle: number, col: number): number {
    const e = this.#e("dictLen");
    return WasmStateError.check(e.dictLen(handle, col), "dictLen");
  }

  /* ---------------------------------------------------------------- */
  /* The async face                                                    */
  /* ---------------------------------------------------------------- */

  async createTable(schema: readonly ColumnSpec[]): Promise<number> {
    return this.createTableSync(schema);
  }
  async dropTable(handle: number): Promise<void> {
    this.dropTableSync(handle);
  }
  async insertColumns(handle: number, columns: readonly ColumnValues[]): Promise<number> {
    return this.insertColumnsSync(handle, columns);
  }
  async setCell(
    handle: number,
    rowId: number,
    col: number,
    kind: ColumnKind,
    value: CellValue
  ): Promise<void> {
    this.setCellSync(handle, rowId, col, kind, value);
  }
  async deleteRows(handle: number, rowIds: ArrayLike<number>): Promise<void> {
    this.deleteRowsSync(handle, rowIds);
  }
  async setQuery(handle: number, query: WireQuery): Promise<void> {
    this.setQuerySync(handle, query);
  }
  async view(
    handle: number,
    start: number,
    count: number,
    schema: readonly ColumnSpec[]
  ): Promise<DecodedView> {
    return this.viewSync(handle, start, count, schema);
  }
  async dictSince(handle: number, col: number, from: number): Promise<string[]> {
    return this.dictSinceSync(handle, col, from);
  }
  async revision(handle: number): Promise<number> {
    return this.revisionSync(handle);
  }
  async rowCount(handle: number): Promise<number> {
    return this.rowCountSync(handle);
  }
  async totalRows(handle: number): Promise<number> {
    return this.totalRowsSync(handle);
  }
}

export { ColumnType };
