/**
 * A string column's dictionary, as JS knows it: the values in id order and
 * the id of each, kept in step with the engine's by fetching only what it
 * added since. The sync store and the worker host read strings out of it,
 * and appendRows interns against it, so only strings the engine has never
 * seen cross into it.
 *
 * Internal.
 */

import { decodeDict, Status, type EngineExports } from "./abi";
import { unpack } from "../core/wasm/memory";

export interface Dictionary {
  readonly values: string[];
  readonly ids: Map<string, number>;
}

export const emptyDictionary = (): Dictionary => ({ values: [], ids: new Map() });

/** The entries the engine added at or after `from`, or null if it refused. */
export function readDictSince(
  e: EngineExports,
  handle: number,
  col: number,
  from: number
): string[] | null {
  const packed = e.dictSince(handle, col, from);
  if (packed === 0n) return null;
  const { ptr, len } = unpack(packed);
  return decodeDict(new Uint8Array(e.memory.buffer, ptr, len));
}

/** Add whatever the engine holds beyond `dict`. Returns a status. */
export function catchUp(e: EngineExports, handle: number, col: number, dict: Dictionary): number {
  const length = e.dictLen(handle, col);
  if (length < 0) return length;
  if (length === dict.values.length) return Status.OK;
  const added = readDictSince(e, handle, col, dict.values.length);
  if (!added) return Status.BadArgument;
  for (const value of added) {
    if (!dict.ids.has(value)) dict.ids.set(value, dict.values.length);
    dict.values.push(value);
  }
  return Status.OK;
}
