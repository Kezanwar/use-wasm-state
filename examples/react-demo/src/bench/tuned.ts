/**
 * Tuned JS: roughly the best plain JS can reasonably do.
 *
 * The engine's own strategy, written in JS. Columnar typed arrays, strings
 * dictionary-encoded per column, string filters and search decided once
 * per dictionary entry rather than per row, string sorts on a cached rank
 * per entry, and the order kept as an index array sorted with a comparator
 * over typed arrays. What it does not do is radix-sort, which is past what
 * an app would reasonably write.
 */

import type { DataGridSchema, SchemaSpec } from "use-wasm-state/datagrid";
import {
  clampWindow,
  compareText,
  EMPTY_QUERY,
  isActive,
  lowerAscii,
  type BaselineGrid,
  type FullQuery,
} from "./baseline";

interface Dictionary {
  values: string[];
  lower: string[];
  index: Map<string, number>;
  /** Position of each entry in the dictionary sorted by value. */
  rank: Int32Array;
  rankFor: number;
}

type Column = Int32Array | Float64Array;

export function createTunedGrid<S extends SchemaSpec>(schema: DataGridSchema<S>): BaselineGrid {
  const { kinds } = schema;
  const isString = kinds.map((kind) => kind === "string");

  let capacity = 0;
  let length = 0;
  let cols: Column[] = kinds.map((kind) =>
    kind === "f64" ? new Float64Array(0) : new Int32Array(0)
  );
  let deleted = new Uint8Array(0);
  const dicts: (Dictionary | null)[] = kinds.map((kind) =>
    kind === "string"
      ? { values: [], lower: [], index: new Map(), rank: new Int32Array(0), rankFor: -1 }
      : null
  );

  let order = new Int32Array(0);
  let orderLength = 0;
  let query: FullQuery = EMPTY_QUERY;

  const grow = (needed: number) => {
    if (needed <= capacity) return;
    capacity = Math.max(needed, capacity * 2, 1024);
    cols = cols.map((col) => {
      const next =
        col instanceof Float64Array ? new Float64Array(capacity) : new Int32Array(capacity);
      next.set(col.subarray(0, length));
      return next;
    });
    const nextDeleted = new Uint8Array(capacity);
    nextDeleted.set(deleted.subarray(0, length));
    deleted = nextDeleted;
  };

  const intern = (dict: Dictionary, value: string): number => {
    let id = dict.index.get(value);
    if (id === undefined) {
      id = dict.values.length;
      dict.values.push(value);
      dict.lower.push(lowerAscii(value));
      dict.index.set(value, id);
    }
    return id;
  };

  const rankOf = (dict: Dictionary): Int32Array => {
    const n = dict.values.length;
    if (dict.rankFor === n) return dict.rank;
    const byValue = Array.from({ length: n }, (_, i) => i).sort(
      (a, b) =>
        compareText(dict.lower[a]!, dict.lower[b]!) || compareText(dict.values[a]!, dict.values[b]!)
    );
    dict.rank = new Int32Array(n);
    byValue.forEach((entry, position) => (dict.rank[entry] = position));
    dict.rankFor = n;
    return dict.rank;
  };

  /** Which dictionary entries satisfy a test, decided once per entry. */
  const entries = (dict: Dictionary, test: (value: string, lower: string) => boolean) => {
    const hit = new Uint8Array(dict.values.length);
    for (let i = 0; i < hit.length; i++) hit[i] = test(dict.values[i]!, dict.lower[i]!) ? 1 : 0;
    return hit;
  };

  const rebuild = () => {
    const col = (name: string) => schema.indexOf[name as keyof typeof schema.indexOf];

    // Each filter becomes a per-row test over typed arrays.
    const tests = query.filters.map((clause): ((id: number) => boolean) => {
      const c = col(clause.column);
      const data = cols[c]!;
      if (isString[c]) {
        const dict = dicts[c]!;
        const hit =
          clause.op === "contains"
            ? entries(dict, (_, lower) => lower.includes(lowerAscii(clause.value as string)))
            : clause.op === "in"
              ? entries(dict, (value) => (clause.value as readonly string[]).includes(value))
              : entries(dict, (value) => value === clause.value);
        return clause.op === "ne" ? (id) => hit[data[id]!] === 0 : (id) => hit[data[id]!] === 1;
      }
      const n = clause.value as number;
      switch (clause.op) {
        case "eq":
          return (id) => data[id] === n;
        case "ne":
          return (id) => data[id] !== n;
        case "lt":
          return (id) => data[id]! < n;
        case "le":
          return (id) => data[id]! <= n;
        case "gt":
          return (id) => data[id]! > n;
        case "ge":
          return (id) => data[id]! >= n;
        default: {
          const [low, high] = clause.value as readonly [number, number];
          return (id) => data[id]! >= low && data[id]! <= high;
        }
      }
    });

    const needle = lowerAscii(query.search);
    const searched =
      needle === ""
        ? []
        : kinds.flatMap((_, c) =>
            isString[c]
              ? [{ data: cols[c]!, hit: entries(dicts[c]!, (_, lower) => lower.includes(needle)) }]
              : []
          );

    const out = new Int32Array(length);
    let m = 0;
    outer: for (let id = 0; id < length; id++) {
      if (deleted[id]) continue;
      for (const test of tests) if (!test(id)) continue outer;
      if (searched.length > 0 && !searched.some(({ data, hit }) => hit[data[id]!] === 1)) continue;
      out[m++] = id;
    }

    if (query.sort.length > 0) {
      const keys = query.sort.map((key) => {
        const c = col(key.column);
        return {
          data: cols[c]!,
          rank: isString[c] ? rankOf(dicts[c]!) : null,
          sign: key.direction === "desc" ? -1 : 1,
        };
      });
      // Ties broken by id explicitly, so the result does not depend on the
      // sort being stable.
      out.subarray(0, m).sort((a, b) => {
        for (const { data, rank, sign } of keys) {
          const x = rank ? rank[data[a]!]! : data[a]!;
          const y = rank ? rank[data[b]!]! : data[b]!;
          if (x !== y) return x < y ? -sign : sign;
        }
        return a - b;
      });
    }

    order = out;
    orderLength = m;
  };

  return {
    get rowCount() {
      return orderLength;
    },
    get totalRows() {
      return length;
    },

    insertColumns(columns) {
      const first = length;
      const added = columns[0]?.length ?? 0;
      grow(length + added);
      columns.forEach((values, c) => {
        const target = cols[c]!;
        if (isString[c]) {
          const dict = dicts[c]!;
          const strings = values as readonly string[];
          for (let i = 0; i < added; i++) target[first + i] = intern(dict, strings[i]!);
        } else {
          target.set(values as ArrayLike<number>, first);
        }
      });
      length += added;
      if (isActive(query)) rebuild();
      else {
        const next = new Int32Array(orderLength + added);
        next.set(order.subarray(0, orderLength));
        for (let i = 0; i < added; i++) next[orderLength + i] = first + i;
        order = next;
        orderLength += added;
      }
      return first;
    },

    setCell(rowId, col, value) {
      cols[col]![rowId] = isString[col] ? intern(dicts[col]!, value as string) : (value as number);
      if (isActive(query)) rebuild();
    },

    deleteRows(rowIds) {
      for (let i = 0; i < rowIds.length; i++) deleted[rowIds[i]!] = 1;
      if (isActive(query)) {
        rebuild();
        return;
      }
      let m = 0;
      for (let i = 0; i < orderLength; i++) if (!deleted[order[i]!]) order[m++] = order[i]!;
      orderLength = m;
    },

    setQuery(next) {
      query = next;
      rebuild();
    },

    window(start, count) {
      const w = clampWindow(orderLength, start, count);
      return { start: w.start, ids: order.slice(w.start, w.start + w.count) };
    },

    get(rowId, col) {
      const value = cols[col]![rowId]!;
      return isString[col] ? dicts[col]!.values[value]! : value;
    },
  };
}
