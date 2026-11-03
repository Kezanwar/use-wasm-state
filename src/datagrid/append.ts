/**
 * Appending rows: the one place reserveRows and commitRows are called.
 *
 * A load writes every column straight into the grid's own storage, so the
 * dataset is never held twice in linear memory. That takes offsets into
 * the grid's columns, which hold only until the next reserve, and typed
 * array views, which any growth of memory detaches. So the whole exchange
 * happens inside this one synchronous function and no offset ever leaves
 * it: nothing can run between the reserve and the commit, because nothing
 * else is handed the chance.
 *
 * Internal.
 */

import { encodeStrings, Status, type EngineExports } from "./abi";
import type { ColumnValues } from "./client";
import { bytesIn, u32In, withInput, type InputArg } from "../core/wasm/input";

/**
 * Append rows, one entry per column in schema order.
 *
 * Returns the first row id, or a negative status. A rejected append leaves
 * the grid as it was.
 */
export function appendRows(
  e: EngineExports,
  handle: number,
  columns: readonly ColumnValues[]
): number {
  const n = columns[0]?.values.length ?? 0;
  if (columns.some((column) => column.values.length !== n)) return Status.RowCount;

  // Reserve, then write every number into its final place. The views are
  // taken after the reserve, which may have grown memory.
  const reserved = withInput(e, [u32In(new Uint32Array(columns.length))], ([out]) => {
    const status = e.reserveRows(handle, n, out.ptr, columns.length);
    if (status < 0) return status;
    const at = new Uint32Array(e.memory.buffer, out.ptr, columns.length);
    columns.forEach((column, i) => {
      if (column.kind === "f64") new Float64Array(e.memory.buffer, at[i], n).set(column.values);
      if (column.kind === "i32") new Int32Array(e.memory.buffer, at[i], n).set(column.values);
    });
    return Status.OK;
  });
  if (reserved < 0) return reserved;

  // Then the strings, as text the engine interns, and the commit.
  const args: InputArg[] = [];
  const text: number[] = [];
  for (const column of columns) {
    if (column.kind !== "string") {
      text.push(-1);
      continue;
    }
    const { blob, offsets } = encodeStrings(column.values);
    text.push(args.length);
    args.push(bytesIn(blob), u32In(offsets));
  }
  const descIndex = args.length;
  args.push(u32In(new Uint32Array(columns.length * 4)));

  return withInput(e, args, (blocks) => {
    const descs = new Uint32Array(e.memory.buffer, blocks[descIndex]!.ptr, columns.length * 4);
    text.forEach((block, i) => {
      if (block === -1) return;
      descs.set([blocks[block]!.ptr, blocks[block]!.len, blocks[block + 1]!.ptr, n], i * 4);
    });
    return e.commitRows(handle, n, blocks[descIndex]!.ptr, columns.length);
  });
}
