/**
 * Typical JS: what a React app usually does.
 *
 * An array of row objects, Array.prototype.filter and sort, and strings
 * compared by lowercasing them on the spot. An edit replaces the row object
 * rather than mutating it, the way state updates are written. Nothing is
 * cached between queries, because nothing usually is.
 *
 * toLowerCase folds more than the engine's ASCII fold, so the two agree on
 * ASCII data, which is what they are compared on.
 */

import type { DataGridSchema, SchemaSpec } from "use-wasm-state/datagrid";
import {
  clampWindow,
  compareText,
  EMPTY_QUERY,
  isActive,
  type BaselineGrid,
  type FullQuery,
  type Value,
} from "./baseline";

type RowObject = Record<string, Value>;

export function createTypicalGrid<S extends SchemaSpec>(schema: DataGridSchema<S>): BaselineGrid {
  const { names, kinds } = schema;
  const strings = names.filter((_, col) => kinds[col] === "string");

  let rows: RowObject[] = [];
  const deleted = new Set<number>();
  let order: number[] = [];
  let query: FullQuery = EMPTY_QUERY;

  const passes = (value: Value, clause: FullQuery["filters"][number]): boolean => {
    if (typeof value === "string") {
      switch (clause.op) {
        case "eq":
          return value === clause.value;
        case "ne":
          return value !== clause.value;
        case "in":
          return (clause.value as readonly string[]).includes(value);
        case "contains":
          return value.toLowerCase().includes((clause.value as string).toLowerCase());
      }
      return false;
    }
    const n = clause.value as number;
    switch (clause.op) {
      case "eq":
        return value === n;
      case "ne":
        return value !== n;
      case "lt":
        return value < n;
      case "le":
        return value <= n;
      case "gt":
        return value > n;
      case "ge":
        return value >= n;
      case "between": {
        const [low, high] = clause.value as readonly [number, number];
        return value >= low && value <= high;
      }
    }
    return false;
  };

  const compare = (a: RowObject, b: RowObject, keys: FullQuery["sort"]): number => {
    for (const key of keys) {
      const x = a[key.column]!;
      const y = b[key.column]!;
      let result: number;
      if (typeof x === "number") result = x - (y as number);
      else {
        result = compareText(x.toLowerCase(), (y as string).toLowerCase());
        if (result === 0) result = compareText(x, y as string);
      }
      if (result !== 0) return key.direction === "desc" ? -result : result;
    }
    return 0;
  };

  const rebuild = () => {
    const { filters, search, sort } = query;
    const needle = search.toLowerCase();

    let ids = rows.map((_, id) => id).filter((id) => !deleted.has(id));
    if (filters.length > 0) {
      ids = ids.filter((id) =>
        filters.every((clause) => passes(rows[id]![clause.column]!, clause))
      );
    }
    if (needle !== "") {
      ids = ids.filter((id) =>
        strings.some((column) => (rows[id]![column] as string).toLowerCase().includes(needle))
      );
    }
    // Stable, and the input is in id order, so ties keep it.
    if (sort.length > 0) ids.sort((a, b) => compare(rows[a]!, rows[b]!, sort));
    order = ids;
  };

  return {
    get rowCount() {
      return order.length;
    },
    get totalRows() {
      return rows.length;
    },

    insertColumns(columns) {
      const first = rows.length;
      const length = columns[0]?.length ?? 0;
      const added: RowObject[] = new Array(length);
      for (let i = 0; i < length; i++) {
        const row: RowObject = {};
        for (let col = 0; col < names.length; col++) row[names[col]!] = columns[col]![i]!;
        added[i] = row;
      }
      rows = rows.concat(added);
      if (isActive(query)) rebuild();
      else for (let i = 0; i < length; i++) order.push(first + i);
      return first;
    },

    setCell(rowId, col, value) {
      rows[rowId] = { ...rows[rowId]!, [names[col]!]: value };
      if (isActive(query)) rebuild();
    },

    deleteRows(rowIds) {
      for (let i = 0; i < rowIds.length; i++) deleted.add(rowIds[i]!);
      if (isActive(query)) rebuild();
      else order = order.filter((id) => !deleted.has(id));
    },

    setQuery(next) {
      query = next;
      rebuild();
    },

    window(start, count) {
      const w = clampWindow(order.length, start, count);
      return { start: w.start, ids: Int32Array.from(order.slice(w.start, w.start + w.count)) };
    },

    get(rowId, col) {
      return rows[rowId]![names[col]!]!;
    },

    // The objects it already holds, which is what a list renders.
    rows(ids) {
      return Array.from(ids, (id) => rows[id]!);
    },
  };
}
