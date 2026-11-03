/**
 * use-wasm-state/datagrid: a columnar grid whose sort, filter and search
 * run in Go, with only the rows on screen crossing to JS.
 *
 * Ships its own engine, datagrid.wasm, and its own worker,
 * datagrid.worker.js, both resolved beside this bundle. Shared grids are
 * held by the providers in `use-wasm-state`.
 */

export { useWasmDataGridAsync, useWasmDataGridSync } from "./use-wasm-data-grid";
export type {
  UseWasmDataGridAsyncOptions,
  UseWasmDataGridResult,
  UseWasmDataGridSyncOptions,
} from "./use-wasm-data-grid";

export { useDataGridQuery, useDataGridStats, useDataGridView } from "./read-hooks";
export type { DataGridStats } from "./read-hooks";

export { defineDataGrid } from "./define";
export type { DataGridDef, DataGridDefOptions } from "./define";

export { defineSchema } from "./schema";
export type {
  ColumnArray,
  ColumnKind,
  ColumnsInput,
  DataGridSchema,
  Row,
  SchemaSpec,
  ValueOf,
} from "./schema";

export type { DataGridReader, DataGridStore, DataGridView, RowIds } from "./store";
export type { AnyDataGridStore, AsyncDataGridStore } from "./async-store";

export type {
  DataGridQuery,
  FilterClause,
  NumericOp,
  SortDirection,
  SortSpec,
  StringOp,
} from "./query";
