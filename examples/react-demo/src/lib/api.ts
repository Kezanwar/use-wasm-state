/**
 * Every public export of use-wasm-state, per entry point, with its
 * signature.
 *
 * Kept apart from the page that renders it so test/api-page.test.ts can
 * hold these keys against each entry's own exports. A name added to a
 * barrel and not documented here fails that test.
 */

/** `use-wasm-state`: what every state pattern shares. */
export const ROOT_API = {
  WasmStateSyncProvider: `function WasmStateSyncProvider(props: {
  urls?: Record<string, { wasmUrl?: string | URL }>;
  children?: ReactNode;
}): JSX.Element;`,

  WasmStateAsyncProvider: `function WasmStateAsyncProvider(props: {
  urls?: Record<string, { wasmUrl?: string | URL; workerUrl?: string | URL }>;
  children?: ReactNode;
}): JSX.Element;`,

  useWasmStateSync: `function useWasmStateSync(): WasmState;`,

  useWasmStateAsync: `function useWasmStateAsync(): WasmState;`,

  WasmState: `interface WasmState {
  drop(def: WasmStateDef): void;
}`,

  WasmStateDef: `interface WasmStateDef {
  readonly key: string;
}`,

  WasmStateSyncProviderProps: `interface WasmStateSyncProviderProps {
  urls?: Readonly<Record<string, { wasmUrl?: string | URL }>>;
  children?: ReactNode;
}`,

  WasmStateAsyncProviderProps: `interface WasmStateAsyncProviderProps {
  urls?: Readonly<Record<string, { wasmUrl?: string | URL; workerUrl?: string | URL }>>;
  children?: ReactNode;
}`,

  WasmStateError: `class WasmStateError extends Error {
  readonly code: WasmStateErrorCode;
  readonly status: number;
  readonly op: string;
}`,

  WasmStateErrorCode: `type WasmStateErrorCode =
  | "bad-handle" | "out-of-range" | "row-deleted" | "wrong-type"
  | "row-count" | "bad-schema" | "bad-argument"
  | "disposed" | "schema_mismatch" | "no_provider" | "engine";`,
} as const satisfies Record<string, string>;

/** `use-wasm-state/datagrid`: the grid, its engine and its worker. */
export const DATAGRID_API = {
  useWasmDataGridSync: `function useWasmDataGridSync<S extends SchemaSpec>(
  def: DataGridDef<S>
): UseWasmDataGridResult<DataGridStore<S>>;

function useWasmDataGridSync<S extends SchemaSpec>(
  schema: DataGridSchema<S>,
  options?: UseWasmDataGridSyncOptions<S>
): UseWasmDataGridResult<DataGridStore<S>>;`,

  useWasmDataGridAsync: `function useWasmDataGridAsync<S extends SchemaSpec>(
  def: DataGridDef<S>
): UseWasmDataGridResult<AsyncDataGridStore<S>>;

function useWasmDataGridAsync<S extends SchemaSpec>(
  schema: DataGridSchema<S>,
  options?: UseWasmDataGridAsyncOptions<S>
): UseWasmDataGridResult<AsyncDataGridStore<S>>;`,

  useDataGridView: `function useDataGridView<S extends SchemaSpec>(
  grid: DataGridReader<S> | null,
  start: number,
  count: number
): DataGridView<S> | null;`,

  useDataGridStats: `function useDataGridStats<S extends SchemaSpec>(
  grid: DataGridReader<S> | null
): DataGridStats | null;`,

  useDataGridQuery: `function useDataGridQuery<S extends SchemaSpec>(
  grid: DataGridReader<S> | null
): Required<DataGridQuery<S>> | null;`,

  defineDataGrid: `function defineDataGrid<S extends SchemaSpec>(
  key: string,
  schema: DataGridSchema<S>,
  options?: DataGridDefOptions<S>
): DataGridDef<S>;

export const Orders = defineDataGrid("orders", schema, { initialRows });`,

  DataGridDef: `interface DataGridDef<S extends SchemaSpec> {
  readonly key: string;
  readonly schema: DataGridSchema<S>;
  readonly initialRows: readonly Row<S>[] | undefined;
}`,

  DataGridDefOptions: `interface DataGridDefOptions<S extends SchemaSpec> {
  initialRows?: readonly Row<S>[];
}`,

  UseWasmDataGridResult: `type UseWasmDataGridResult<T> =
  | { status: "loading"; isReady: false; grid: null; error: null }
  | { status: "ready";   isReady: true;  grid: T;    error: null }
  | { status: "error";   isReady: false; grid: null; error: Error };`,

  UseWasmDataGridSyncOptions: `interface UseWasmDataGridSyncOptions<S extends SchemaSpec> {
  wasmUrl?: string | URL;
  initialRows?: readonly Row<S>[];
}`,

  UseWasmDataGridAsyncOptions: `interface UseWasmDataGridAsyncOptions<S extends SchemaSpec>
  extends UseWasmDataGridSyncOptions<S> {
  workerUrl?: string | URL;
}`,

  defineSchema: `function defineSchema<const S extends SchemaSpec>(
  spec: S
): DataGridSchema<S>;

defineSchema({ id: "i32", name: "string", price: "f64" });`,

  Row: `type Row<S extends SchemaSpec> = {
  [K in keyof S]: S[K] extends "string" ? string : number;
};`,

  DataGridSchema: `interface DataGridSchema<S extends SchemaSpec> {
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

  DataGridReader: `interface DataGridReader<S extends SchemaSpec> {
  readonly schema: DataGridSchema<S>;
  readonly version: number;
  readonly lastCallMs: number;
  readonly revision: number;
  readonly rowCount: number;
  readonly totalRows: number;
  readonly query: Required<DataGridQuery<S>>;

  view(start: number, count: number): DataGridView<S>;
  readWindow(start: number, count: number): Promise<DataGridView<S>>;
  watch(start: number, count: number): () => void;
  subscribe(listener: () => void): () => void;
}`,

  DataGridStore: `interface DataGridStore<S extends SchemaSpec> extends DataGridReader<S> {
  insertRows(rows: readonly Row<S>[]): RowIds;
  insertColumns(columns: ColumnsInput<S>): RowIds;
  setCell<K extends keyof S & string>(rowId: number, column: K, value: Row<S>[K]): void;
  deleteRows(rowIds: ArrayLike<number>): void;

  setQuery(query: DataGridQuery<S>): void;
  sortBy(column: keyof S & string, direction?: SortDirection): void;
  filter(clauses: readonly FilterClause<S>[]): void;
  search(text: string): void;
  clearQuery(): void;

  dispose(): void;
}`,

  AsyncDataGridStore: `interface AsyncDataGridStore<S extends SchemaSpec> extends DataGridReader<S> {
  insertRows(rows: readonly Row<S>[]): Promise<RowIds>;
  insertColumns(columns: ColumnsInput<S>): Promise<RowIds>;
  setCell(rowId: number, column: K, value: Row<S>[K]): Promise<void>;
  deleteRows(rowIds: ArrayLike<number>): Promise<void>;

  setQuery(query: DataGridQuery<S>): Promise<void>;
  sortBy(column, direction?): Promise<void>;
  filter(clauses: readonly FilterClause<S>[]): Promise<void>;
  search(text: string): Promise<void>;
  clearQuery(): Promise<void>;

  dispose(): void;
}`,

  AnyDataGridStore: `type AnyDataGridStore<S extends SchemaSpec> =
  | DataGridStore<S>
  | AsyncDataGridStore<S>;`,

  DataGridView: `interface DataGridView<S extends SchemaSpec> {
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

  DataGridStats: `interface DataGridStats {
  revision: number;
  rowCount: number;
  totalRows: number;
}`,

  DataGridQuery: `interface DataGridQuery<S extends SchemaSpec> {
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
} as const satisfies Record<string, string>;

/** The names the page documents, per entry point. */
export const DOCUMENTED = {
  root: Object.keys(ROOT_API),
  datagrid: Object.keys(DATAGRID_API),
};
