/**
 * Every public export of use-wasm-state, with its signature.
 *
 * Kept apart from the page that renders it so test/api-page.test.ts can
 * hold these keys against the package's own exports. A name added to
 * src/index.ts and not documented here fails that test.
 */
export const API = {
  useWasmTable: `function useWasmTable<S extends SchemaSpec, M extends Mode = "sync">(
  schema: TableSchema<S>,
  options?: UseWasmTableOptions<S, M>
): UseWasmTableResult<S, M>;`,

  useTableView: `function useTableView<S extends SchemaSpec>(
  table: TableReader<S> | null,
  start: number,
  count: number
): TableView<S> | null;`,

  useTableStats: `function useTableStats<S extends SchemaSpec>(
  table: TableReader<S> | null
): TableStats | null;`,

  useTableQuery: `function useTableQuery<S extends SchemaSpec>(
  table: TableReader<S> | null
): Required<TableQuery<S>> | null;`,

  defineSchema: `function defineSchema<const S extends SchemaSpec>(
  spec: S
): TableSchema<S>;

defineSchema({ id: "i32", name: "string", price: "f64" });`,

  Row: `type Row<S extends SchemaSpec> = {
  [K in keyof S]: S[K] extends "string" ? string : number;
};`,

  TableSchema: `interface TableSchema<S extends SchemaSpec> {
  readonly spec: S;
  readonly names: readonly (keyof S & string)[];
  readonly kinds: readonly ColumnKind[];
  readonly indexOf: Readonly<Record<keyof S & string, number>>;
}`,

  SchemaSpec: `type SchemaSpec = Record<string, ColumnKind>;`,

  ColumnKind: `type ColumnKind = "i32" | "f64" | "string";`,

  ValueOf: `type ValueOf<K extends ColumnKind> = K extends "string" ? string : number;`,

  ColumnArray: `type ColumnArray<K extends ColumnKind> = K extends "string"
  ? readonly string[]
  : K extends "f64"
    ? Float64Array | readonly number[]
    : Int32Array | readonly number[];`,

  ColumnsInput: `type ColumnsInput<S extends SchemaSpec> = {
  [K in keyof S]: ColumnArray<S[K]>;
};`,

  TableStore: `interface TableStore<S extends SchemaSpec> {
  readonly schema: TableSchema<S>;

  insertRows(rows: readonly Row<S>[]): RowIds;
  insertColumns(columns: ColumnsInput<S>): RowIds;
  setCell<K extends keyof S & string>(rowId: number, column: K, value: Row<S>[K]): void;
  deleteRows(rowIds: ArrayLike<number>): void;

  setQuery(query: TableQuery<S>): void;
  sortBy(column: keyof S & string, direction?: SortDirection): void;
  filter(clauses: readonly FilterClause<S>[]): void;
  search(text: string): void;
  clearQuery(): void;
  readonly query: Required<TableQuery<S>>;

  readonly revision: number;
  readonly rowCount: number;
  readonly totalRows: number;

  view(start: number, count: number): TableView<S>;
  subscribe(listener: () => void): () => void;
  dispose(): void;
}`,

  TableView: `interface TableView<S extends SchemaSpec> {
  readonly start: number;
  readonly ids: Int32Array;
  readonly length: number;
  get<K extends keyof S & string>(i: number, column: K): Row<S>[K];
  row(i: number): Row<S>;
  rows(): Row<S>[];
}`,

  RowIds: `interface RowIds extends Iterable<number> {
  readonly first: number;
  readonly length: number;
  at(i: number): number | undefined;
  toArray(): number[];
}`,

  TableStats: `interface TableStats {
  revision: number;
  rowCount: number;
  totalRows: number;
}`,

  TableQuery: `interface TableQuery<S extends SchemaSpec> {
  sort?: readonly SortSpec<S>[];
  filters?: readonly FilterClause<S>[];
  search?: string;
}

// live rows -> filters (AND) -> search -> sort`,

  SortSpec: `interface SortSpec<S extends SchemaSpec> {
  column: keyof S & string;
  direction?: SortDirection;
}`,

  SortDirection: `type SortDirection = "asc" | "desc";`,

  FilterClause: `type FilterClause<S extends SchemaSpec> = {
  [K in keyof S & string]: S[K] extends "string"
    ? { column: K; op: StringOp; value: string }
    | { column: K; op: "in"; value: readonly string[] }
    : { column: K; op: NumericOp; value: number }
    | { column: K; op: "between"; value: readonly [number, number] };
}[keyof S & string];`,

  NumericOp: `type NumericOp = "eq" | "ne" | "lt" | "le" | "gt" | "ge";`,

  StringOp: `type StringOp = "eq" | "ne" | "contains";`,

  createEngine: `function createEngine<M extends Mode = "sync">(
  options?: EngineOptions & { mode?: M }
): Promise<Engine<M>>;`,

  Mode: `type Mode = "sync" | "worker";`,

  StoreFor: `type StoreFor<M extends Mode, S extends SchemaSpec> =
  M extends "worker" ? AsyncTableStore<S> : TableStore<S>;`,

  TableReader: `interface TableReader<S extends SchemaSpec> {
  readonly schema: TableSchema<S>;
  readonly version: number;
  readonly revision: number;
  readonly rowCount: number;
  readonly totalRows: number;
  readonly query: Required<TableQuery<S>>;

  view(start: number, count: number): TableView<S>;
  readWindow(start: number, count: number): Promise<TableView<S>>;
  watch(start: number, count: number): () => void;
  subscribe(listener: () => void): () => void;
}`,

  AsyncTableStore: `interface AsyncTableStore<S extends SchemaSpec> extends TableReader<S> {
  insertRows(rows: readonly Row<S>[]): Promise<RowIds>;
  insertColumns(columns: ColumnsInput<S>): Promise<RowIds>;
  setCell(rowId: number, column: K, value: Row<S>[K]): Promise<void>;
  deleteRows(rowIds: ArrayLike<number>): Promise<void>;

  setQuery(query: TableQuery<S>): Promise<void>;
  sortBy(column, direction?): Promise<void>;
  filter(clauses: readonly FilterClause<S>[]): Promise<void>;
  search(text: string): Promise<void>;
  clearQuery(): Promise<void>;

  dispose(): void;
}`,

  Engine: `interface Engine<M extends Mode = Mode> {
  readonly mode: M;
  createTable<S extends SchemaSpec>(schema: TableSchema<S>): StoreFor<M, S>;
  dispose(): void;
}`,

  EngineOptions: `interface EngineOptions {
  mode?: Mode;
  wasmUrl?: string | URL;
  workerUrl?: string | URL;
  cache?: boolean;
}`,

  WasmStateError: `class WasmStateError extends Error {
  readonly code: WasmStateErrorCode;
  readonly status: number;
  readonly op: string;
}`,

  WasmStateErrorCode: `type WasmStateErrorCode =
  | "bad-handle" | "out-of-range" | "row-deleted" | "wrong-type"
  | "row-count" | "bad-schema" | "bad-argument"
  | "disposed" | "not_implemented" | "engine";`,

  UseWasmTableResult: `type UseWasmTableResult<S extends SchemaSpec, M extends Mode> =
  | { status: "loading"; isReady: false; table: null;             error: null }
  | { status: "ready";   isReady: true;  table: StoreFor<M, S>;   error: null }
  | { status: "error";   isReady: false; table: null;             error: Error };`,

  UseWasmTableOptions: `interface UseWasmTableOptions<S extends SchemaSpec, M extends Mode> {
  wasmUrl?: string | URL;
  workerUrl?: string | URL;
  initialRows?: readonly Row<S>[];
  shared?: string;
  mode?: M;
}`,
} as const satisfies Record<string, string>;

/** The names this page documents. */
export const DOCUMENTED = Object.keys(API);
