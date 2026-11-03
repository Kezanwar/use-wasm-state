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
 * Strings are interned here, against each column's dictionary, and written
 * as ids like any other number. Only the strings the dictionary lacks are
 * encoded and sent, which for 200k rows over five thousand names is five
 * thousand strings rather than 200k.
 *
 * Internal.
 */

import { encodeStrings, Status, type EngineExports } from "./abi";
import type { ColumnValues } from "./client";
import { catchUp, emptyDictionary, readDictSince, type Dictionary } from "./dictionary";
import { bytesIn, u32In, withInput, type InputArg } from "../core/wasm/input";

/**
 * Append rows, one entry per column in schema order, keeping each string
 * column's entry of `dictionaries` in step with the engine. Missing entries
 * are created.
 *
 * Returns the first row id, or a negative status. A rejected append leaves
 * the grid and the dictionaries as they were.
 */
export function appendRows(
  e: EngineExports,
  handle: number,
  columns: readonly ColumnValues[],
  dictionaries: (Dictionary | undefined)[]
): number {
  const n = columns[0]?.values.length ?? 0;
  if (columns.some((column) => column.values.length !== n)) return Status.RowCount;

  // An edit may have added strings since this side last looked.
  for (let i = 0; i < columns.length; i++) {
    if (columns[i]!.kind !== "string") continue;
    const status = catchUp(e, handle, i, (dictionaries[i] ??= emptyDictionary()));
    if (status < 0) return status;
  }

  // Per string column, the values it was given that its dictionary lacked,
  // in the order their provisional ids name them.
  const added: string[][] = [];
  let first: number = Status.BadArgument;
  try {
    // Reserve, then write every column into its final place. The views are
    // taken after the reserve, which may have grown memory.
    const reserved = withInput(e, [u32In(new Uint32Array(columns.length))], ([out]) => {
      const status = e.reserveRows(handle, n, out.ptr, columns.length);
      if (status < 0) return status;
      const at = new Uint32Array(e.memory.buffer, out.ptr, columns.length);
      columns.forEach((column, i) => {
        if (column.kind === "f64") {
          new Float64Array(e.memory.buffer, at[i], n).set(column.values);
        } else if (column.kind === "i32") {
          new Int32Array(e.memory.buffer, at[i], n).set(column.values);
        } else {
          const ids = new Int32Array(e.memory.buffer, at[i], n);
          added[i] = intern(column.values, dictionaries[i]!, ids);
        }
      });
      return Status.OK;
    });
    if (reserved < 0) return (first = reserved);

    // Then the new strings, and the commit.
    const args: InputArg[] = [];
    const blocks: number[] = [];
    columns.forEach((_column, i) => {
      if (!added[i]) return void (blocks[i] = -1);
      const { blob, offsets } = encodeStrings(added[i]);
      blocks[i] = args.length;
      args.push(bytesIn(blob), u32In(offsets));
    });
    const descIndex = args.length;
    args.push(u32In(new Uint32Array(columns.length * 4)));

    first = withInput(e, args, (block) => {
      const descs = new Uint32Array(e.memory.buffer, block[descIndex]!.ptr, columns.length * 4);
      blocks.forEach((b, i) => {
        if (b === -1) return;
        descs.set([block[b]!.ptr, block[b]!.len, block[b + 1]!.ptr, added[i]!.length], i * 4);
      });
      return e.commitRows(handle, n, block[descIndex]!.ptr, columns.length);
    });
    return first;
  } finally {
    added.forEach((values, i) => {
      if (!values?.length) return;
      if (first >= 0) settle(e, handle, i, dictionaries[i]!, values);
      else for (const value of values) dictionaries[i]!.ids.delete(value);
    });
  }
}

/**
 * Write each value's id into `ids`. A value the dictionary lacks gets the
 * next id past its end, provisionally, and is returned among the added.
 */
function intern(values: readonly string[], dict: Dictionary, ids: Int32Array): string[] {
  const added: string[] = [];
  const base = dict.values.length;
  for (let r = 0; r < values.length; r++) {
    const value = values[r]!;
    let id = dict.ids.get(value);
    if (id === undefined) {
      id = base + added.length;
      dict.ids.set(value, id);
      added.push(value);
    }
    ids[r] = id;
  }
  return added;
}

/**
 * After a commit, take the engine's word for what it added.
 *
 * Almost always that is exactly the strings sent, in order, and the
 * provisional ids stand. When it is not, the engine found some already
 * held, lone surrogates being the usual way two JS strings are one string
 * of bytes, so the provisional ids are dropped and the dictionary is read
 * back as the engine has it.
 */
function settle(e: EngineExports, handle: number, col: number, dict: Dictionary, sent: string[]) {
  const got = readDictSince(e, handle, col, dict.values.length) ?? [];
  if (got.length === sent.length && got.every((value, j) => value === sent[j])) {
    for (const value of got) dict.values.push(value);
    return;
  }
  for (const value of sent) dict.ids.delete(value);
  catchUp(e, handle, col, dict);
}
