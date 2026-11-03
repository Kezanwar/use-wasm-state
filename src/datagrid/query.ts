/**
 * The query, typed by the schema.
 *
 * A grid has one query: a sort, some filters and a search. Go stores it
 * and builds the row order as
 *
 *   live rows -> filters (AND) -> search -> sort
 *
 * and it persists, so every mutation re-applies it. A row edited out of a
 * filter leaves on its own; an inserted row lands where the sort says.
 *
 * Everything here is named by column, and a column only accepts the
 * operators its kind can answer.
 */

import { FilterOp, type WireFilter, type WireQuery } from "./abi";
import type { ColumnKind, SchemaSpec, DataGridSchema, ValueOf } from "./schema";

export type SortDirection = "asc" | "desc";

/** One column of a multi-column sort, in priority order. */
export interface SortSpec<S extends SchemaSpec = SchemaSpec> {
  column: keyof S & string;
  /** Default: "asc". */
  direction?: SortDirection;
}

/** Operators a number column can answer. */
export type NumericOp = "eq" | "ne" | "lt" | "le" | "gt" | "ge";
/** Operators a string column can answer. `contains` is case-insensitive. */
export type StringOp = "eq" | "ne" | "contains";

/**
 * One filter clause.
 *
 * Distributed over the columns, so `{ column: "price", op: "contains" }` is
 * a type error rather than a runtime one, and the value is typed by the
 * column it names.
 */
export type FilterClause<S extends SchemaSpec = SchemaSpec> = {
  [K in keyof S & string]: S[K] extends "string"
    ? { column: K; op: StringOp; value: string } | { column: K; op: "in"; value: readonly string[] }
    : | { column: K; op: NumericOp; value: number }
      | { column: K; op: "between"; value: readonly [number, number] };
}[keyof S & string];

/** A sort, some filters and a search. Every part is optional. */
export interface DataGridQuery<S extends SchemaSpec = SchemaSpec> {
  sort?: readonly SortSpec<S>[];
  filters?: readonly FilterClause<S>[];
  search?: string;
}

/** Fill in the parts a caller left out, so reads never have to check. */
export function normalizeQuery<S extends SchemaSpec>(
  query: DataGridQuery<S>
): Required<DataGridQuery<S>> {
  return {
    sort: query.sort ?? [],
    filters: query.filters ?? [],
    search: query.search ?? "",
  };
}

const NUMERIC_ONLY = new Set(["lt", "le", "gt", "ge", "between"]);
const STRING_ONLY = new Set(["in", "contains"]);

/**
 * Turn a query into the flat form the wire format carries.
 *
 * Column names become indexes and operators become numbers here, which is
 * also where a name the schema does not have is caught: the engine would
 * reject it too, but saying which name is wrong is more use than a status
 * code.
 */
export function toWireQuery<S extends SchemaSpec>(
  schema: DataGridSchema<S>,
  query: Required<DataGridQuery<S>>
): WireQuery {
  const indexOf = (column: string) => {
    const col = schema.indexOf[column as keyof S & string];
    if (col === undefined) {
      throw new Error(`use-wasm-state: no column named "${column}"`);
    }
    return col;
  };

  const sort = query.sort.map((key) => ({
    col: indexOf(key.column),
    desc: key.direction === "desc",
  }));

  const filters = query.filters.map((clause): WireFilter => {
    const col = indexOf(clause.column);
    const kind = schema.kinds[col] as ColumnKind;
    const op = clause.op as keyof typeof FilterOp;

    if (kind === "string" && NUMERIC_ONLY.has(op)) {
      throw new Error(
        `use-wasm-state: "${op}" needs a number column, and "${clause.column}" holds strings`
      );
    }
    if (kind !== "string" && STRING_ONLY.has(op)) {
      throw new Error(
        `use-wasm-state: "${op}" needs a string column, and "${clause.column}" holds numbers`
      );
    }

    const wire: WireFilter = { col, op: FilterOp[op], number: 0, upper: 0, text: "", list: [] };

    if (kind === "string") {
      if (op === "in") wire.list = clause.value as readonly string[];
      else wire.text = clause.value as string;
      return wire;
    }

    if (op === "between") {
      const [low, high] = clause.value as readonly [number, number];
      wire.number = low;
      wire.upper = high;
      return wire;
    }

    wire.number = clause.value as number;
    return wire;
  });

  return { sort, filters, search: query.search };
}

/** The value type a column's filter takes, for the type tests. */
export type FilterValue<K extends ColumnKind> = ValueOf<K>;
