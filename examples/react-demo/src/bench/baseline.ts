/**
 * What a plain-JS baseline has to do, and nothing more.
 *
 * Two implementations sit behind this, typical and tuned, and ./store.ts
 * wraps either one as a full DataGridStore: version, subscribe, the query
 * helpers, views. So everything that reads a store, the benchmark runner,
 * the correctness test and the Grid component, treats JS and wasm the
 * same, and the comparison is only ever about where the data lives and
 * where the work runs.
 *
 * Semantics are the engine's, exactly:
 *   live rows -> filters (AND) -> search -> sort
 * Sort is stable with ties broken by row id, in either direction. Strings
 * sort case-folded with byte order breaking ties. eq, ne and in match a
 * string exactly; contains and search are case-insensitive and search
 * looks at every string column. between is inclusive. Any mutation re-runs
 * the pipeline while a query is active. Windows are clamped.
 */

export type Value = number | string;

/**
 * A query with every part present, typed by name rather than by schema.
 * The store adapter is where the schema's types are enforced; down here a
 * column is a string and a clause's value is whatever its op takes.
 */
export interface FullQuery {
  sort: readonly { column: string; direction?: "asc" | "desc" }[];
  filters: readonly { column: string; op: string; value: unknown }[];
  search: string;
}

export interface BaselineGrid {
  /** Rows in the current order: live, filtered and searched. */
  readonly rowCount: number;
  /** Rows ever inserted, deleted ones included. */
  readonly totalRows: number;

  /** Append rows, one array per column, in schema order. Returns the first id. */
  insertColumns(columns: readonly (ArrayLike<number> | readonly string[])[]): number;
  setCell(rowId: number, col: number, value: Value): void;
  deleteRows(rowIds: ArrayLike<number>): void;
  setQuery(query: FullQuery): void;

  /** The ids at order[start, start + count), clamped the way the engine clamps. */
  window(start: number, count: number): { start: number; ids: Int32Array };
  /** One cell. */
  get(rowId: number, col: number): Value;
  /** Whole rows, when the baseline already holds them as objects. */
  rows?(ids: Int32Array): Record<string, Value>[];
}

/** Clamp a window exactly as engine/datagrid's Window does. */
export function clampWindow(length: number, start: number, count: number) {
  let s = Math.max(0, start);
  let c = Math.max(0, count);
  if (s > length) s = length;
  if (s + c > length) c = length - s;
  return { start: s, count: c };
}

/** The engine folds A-Z only, so this does too; toLowerCase would fold more. */
export function lowerAscii(text: string): string {
  return /[A-Z]/.test(text) ? text.replace(/[A-Z]+/g, (run) => run.toLowerCase()) : text;
}

/** Byte order on UTF-8 is code-point order; on the ASCII data compared here, also code-unit order. */
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Is a query doing anything? An empty one leaves the order as live rows by id. */
export const isActive = (query: FullQuery) =>
  query.sort.length > 0 || query.filters.length > 0 || query.search !== "";

export const EMPTY_QUERY: FullQuery = { sort: [], filters: [], search: "" };
