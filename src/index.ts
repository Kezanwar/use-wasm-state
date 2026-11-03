/**
 * Public surface of use-wasm-state.
 *
 * Everything under src/engine and src/internal stays private: the wire
 * format, the allocator protocol and the copied react-use-wasm helpers are
 * contracts between this package and its own module, not API. The one
 * exception is WasmStateError, which a consumer has to be able to catch and
 * name.
 */

export { createEngine } from "./store/create-engine";
export type { Engine, EngineOptions } from "./store/create-engine";

export { defineSchema } from "./store/schema";
export type {
  ColumnArray,
  ColumnKind,
  ColumnsInput,
  Row,
  SchemaSpec,
  TableSchema,
  ValueOf,
} from "./store/schema";

export type { RowIds, TableStore, TableView } from "./store/table-store";

export { WasmStateError } from "./engine/errors";
export type { WasmStateErrorCode } from "./engine/errors";

export { useWasmTable } from "./react/use-wasm-table";
export type { UseWasmTableOptions, UseWasmTableResult } from "./react/use-wasm-table";

export { useTableQuery, useTableStats, useTableView } from "./react/use-table-view";
export type { TableStats } from "./react/use-table-view";

export type {
  FilterClause,
  NumericOp,
  SortDirection,
  SortSpec,
  StringOp,
  TableQuery,
} from "./store/query";
