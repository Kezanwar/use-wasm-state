/**
 * Shared grids, identified by a typed definition rather than a string.
 *
 * The schema travels with the key, so two components naming the same grid
 * cannot disagree about its shape. Defining one does nothing at all: no
 * engine, no wasm, safe at module scope and on a server. The grid is made
 * by the first hook that uses it, under whichever provider is above.
 */

import type { StateDef } from "../core/contract";
import type { AsyncDataGridStore } from "./async-store";
import { datagrid, type AsyncGridEngine, type SyncGridEngine } from "./engine";
import type { DataGridSchema, Row, SchemaShape, SchemaSpec } from "./schema";
import type { DataGridStore } from "./store";

export interface DataGridDefOptions<S extends SchemaSpec> {
  /** Inserted once, when the grid is created. Again after a drop. */
  initialRows?: readonly Row<S>[];
}

/** A shared grid, as `defineDataGrid` returns it. */
export interface DataGridDef<S extends SchemaSpec = SchemaSpec> {
  readonly key: string;
  readonly schema: DataGridSchema<S>;
  readonly initialRows: readonly Row<S>[] | undefined;
}

/** The definition with its contract, as the provider sees it. */
export type DataGridStateDef<S extends SchemaSpec = SchemaSpec> = DataGridDef<S> &
  StateDef<DataGridStore<S>, AsyncDataGridStore<S>>;

/**
 * Name a grid and fix its shape, once, at module scope.
 *
 *   export const Orders = defineDataGrid("orders", schema, { initialRows });
 */
export function defineDataGrid<S extends SchemaSpec>(
  key: string,
  schema: DataGridSchema<S>,
  options: DataGridDefOptions<S> = {}
): DataGridDef<S> {
  if (typeof key !== "string" || key === "") {
    throw new Error("use-wasm-state: defineDataGrid needs a non-empty key");
  }
  const def: DataGridStateDef<S> = {
    key,
    schema,
    initialRows: options.initialRows,
    shape: shapeOf(schema),
    ...recipes(schema, options.initialRows),
  };
  return def;
}

/** How a grid is made in each mode, initial rows included. */
export function recipes<S extends SchemaSpec>(
  schema: DataGridSchema<S>,
  initialRows: readonly Row<S>[] | undefined
): Pick<DataGridStateDef<S>, "pattern" | "sync" | "async"> {
  return {
    pattern: datagrid,
    sync: {
      create(engine: SyncGridEngine) {
        const grid = engine.createGrid(schema);
        if (initialRows?.length) grid.insertRows(initialRows);
        return grid;
      },
    },
    async: {
      async create(engine: AsyncGridEngine) {
        const grid = engine.createGrid(schema);
        if (initialRows?.length) await grid.insertRows(initialRows);
        return grid;
      },
    },
  };
}

/** Column names and kinds, in order: what has to agree for two defs to share a key. */
function shapeOf(schema: SchemaShape): string {
  const columns = schema.names.map((name, i) => `${name}:${schema.kinds[i]}`);
  return `${datagrid.name}(${columns.join(",")})`;
}

export function isDataGridDef(value: unknown): value is DataGridStateDef {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { pattern?: unknown }).pattern === datagrid
  );
}
