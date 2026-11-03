/**
 * Schemas, and the row types inferred from them.
 *
 * A schema is written the way it reads:
 *
 *   const schema = defineSchema({ price: "f64", qty: "i32", status: "string" });
 *
 * and everything downstream is typed from it: Row<typeof schema> is
 * { price: number; qty: number; status: string }, setCell only accepts a
 * value its column can hold, and view.get(i, "status") is a string.
 */

import { ColumnType, type ColumnSpec, type ColumnTypeCode } from "../engine/abi";
import type { ColumnKind } from "../engine/client";

/** What a column can hold, as written in a schema. */
export type { ColumnKind };

/** The shape passed to defineSchema: column name to column kind. */
export type SchemaSpec = Record<string, ColumnKind>;

/** The JS type one column kind produces. */
export type ValueOf<K extends ColumnKind> = K extends "string" ? string : number;

/**
 * One row of a table, as an object.
 *
 * `-readonly` because defineSchema takes a `const` type parameter to keep
 * the literal column kinds, and that marks every property of the inferred
 * spec readonly. Rows are ordinary objects a caller builds and fills, so
 * the modifier is dropped on the way through.
 */
export type Row<S extends SchemaSpec> = { -readonly [K in keyof S]: ValueOf<S[K]> };

/** One column's worth of rows, in the form insertColumns takes. */
export type ColumnArray<K extends ColumnKind> = K extends "string"
  ? readonly string[]
  : K extends "f64"
    ? Float64Array | readonly number[]
    : Int32Array | readonly number[];

/** The argument to insertColumns: every column, each as its own array. */
export type ColumnsInput<S extends SchemaSpec> = {
  -readonly [K in keyof S]: ColumnArray<S[K]>;
};

/**
 * A schema, ready to create a table from.
 *
 * `spec` is kept so the types survive; `columns` is the ordered form the
 * engine takes. Column order is the key order of the object passed in,
 * which is also the order every columnar API uses.
 */
export interface TableSchema<S extends SchemaSpec = SchemaSpec> {
  readonly spec: S;
  /** In key order. Index into this is what the engine calls a column. */
  readonly columns: readonly ColumnSpec[];
  /** Column names in order, so a name can be turned into an index. */
  readonly names: readonly (keyof S & string)[];
  /** Column kinds in order, parallel to names. */
  readonly kinds: readonly ColumnKind[];
  /** Index of each column by name. */
  readonly indexOf: Readonly<Record<keyof S & string, number>>;
}

const WIRE: Record<ColumnKind, ColumnTypeCode> = {
  i32: ColumnType.I32,
  f64: ColumnType.F64,
  string: ColumnType.String,
};

/**
 * Declare a table's columns.
 *
 * `const S` is what keeps the literal kinds ("f64", not string) so the row
 * type can be inferred. Column order is the key order of the object.
 */
export function defineSchema<const S extends SchemaSpec>(spec: S): TableSchema<S> {
  const names = Object.keys(spec) as (keyof S & string)[];
  if (names.length === 0) {
    throw new Error("use-wasm-state: defineSchema needs at least one column");
  }

  const kinds = names.map((name) => spec[name] as ColumnKind);
  const columns: ColumnSpec[] = names.map((name, i) => {
    const kind = kinds[i]!;
    if (!(kind in WIRE)) {
      throw new Error(
        `use-wasm-state: column "${name}" has kind "${kind}"; expected "i32", "f64" or "string"`
      );
    }
    return { name, type: WIRE[kind] };
  });

  const indexOf = {} as Record<keyof S & string, number>;
  names.forEach((name, i) => {
    indexOf[name] = i;
  });

  return { spec, columns, names, kinds, indexOf };
}

/**
 * Just enough of a schema to compare two. Structural rather than
 * TableSchema<S>, so a schema of any spec can be passed without the
 * generic fighting back.
 */
export interface SchemaShape {
  readonly names: readonly string[];
  readonly kinds: readonly ColumnKind[];
}

/**
 * Whether two schemas describe the same table.
 *
 * Used by useWasmTable to tell a schema that was merely rebuilt on a
 * re-render from one that actually changed, which it cannot act on.
 */
export function sameShape(a: SchemaShape, b: SchemaShape): boolean {
  if (a.names.length !== b.names.length) return false;
  return a.names.every((name, i) => name === b.names[i] && a.kinds[i] === b.kinds[i]);
}
