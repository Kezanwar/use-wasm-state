/**
 * Every public export of use-wasm-state, with its signature.
 *
 * Kept apart from the page that renders it so test/api-page.test.ts can
 * hold these keys against the package's own exports. A name added to
 * src/index.ts and not documented here fails that test.
 */
export const API = {
  useWasmTable: `function useWasmTable<S extends SchemaSpec>(
  schema: TableSchema<S>,
  options?: UseWasmTableOptions<S>
): UseWasmTableResult<S>;`,

  useTableView: `function useTableView<S extends SchemaSpec>(
  table: TableStore<S> | null,
  start: number,
  count: number
): TableView<S> | null;`,

  useTableStats: `function useTableStats<S extends SchemaSpec>(
  table: TableStore<S> | null
): TableStats | null;`,

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

  createEngine: `function createEngine(options?: EngineOptions): Promise<Engine>;`,

  Engine: `interface Engine {
  createTable<S extends SchemaSpec>(schema: TableSchema<S>): TableStore<S>;
  dispose(): void;
}`,

  EngineOptions: `interface EngineOptions {
  mode?: "sync" | "worker";
  wasmUrl?: string | URL;
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

  UseWasmTableResult: `type UseWasmTableResult<S extends SchemaSpec> =
  | { status: "loading"; isReady: false; table: null;           error: null }
  | { status: "ready";   isReady: true;  table: TableStore<S>;  error: null }
  | { status: "error";   isReady: false; table: null;           error: Error };`,

  UseWasmTableOptions: `interface UseWasmTableOptions<S extends SchemaSpec> {
  wasmUrl?: string | URL;
  initialRows?: readonly Row<S>[];
  shared?: string;
  mode?: "sync" | "worker";
}`,
} as const satisfies Record<string, string>;

/** The names this page documents. */
export const DOCUMENTED = Object.keys(API);
