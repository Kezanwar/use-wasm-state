import { assertType, describe, expectTypeOf, it } from "vitest";
import {
  useWasmStateAsync,
  useWasmStateSync,
  WasmStateAsyncProvider,
  WasmStateError,
  WasmStateSyncProvider,
  type WasmStateDef,
  type WasmStateErrorCode,
} from "../src/index";
import {
  defineDataGrid,
  defineSchema,
  useDataGridQuery,
  useDataGridStats,
  useDataGridView,
  useWasmDataGridAsync,
  useWasmDataGridSync,
  type AnyDataGridStore,
  type AsyncDataGridStore,
  type DataGridDef,
  type DataGridQuery,
  type DataGridReader,
  type DataGridStats,
  type DataGridStore,
  type DataGridView,
  type Row,
  type RowIds,
  type UseWasmDataGridResult,
} from "../src/datagrid/index";

/**
 * The types, which are half of what this package is for. A schema is
 * written once and everything downstream follows from it; if that stops
 * being true the runtime tests will not notice.
 */

const schema = defineSchema({ price: "f64", qty: "i32", status: "string" });
type Schema = typeof schema.spec;

describe("defineSchema", () => {
  it("infers a row type from the column kinds", () => {
    expectTypeOf({} as Row<Schema>).toEqualTypeOf<{
      price: number;
      qty: number;
      status: string;
    }>();
  });

  it("keeps the literal kinds rather than widening to string", () => {
    expectTypeOf({} as Schema["price"]).toEqualTypeOf<"f64">();
    expectTypeOf({} as Schema["status"]).toEqualTypeOf<"string">();
  });

  it("names the columns in key order", () => {
    expectTypeOf(schema.names).toEqualTypeOf<readonly ("price" | "qty" | "status")[]>();
  });
});

declare const grid: DataGridStore<Schema>;

describe("setCell", () => {
  it("takes a value its column can hold", () => {
    grid.setCell(0, "price", 1.5);
    grid.setCell(0, "qty", 2);
    grid.setCell(0, "status", "shipped");
  });

  it("rejects a value of the wrong type", () => {
    // @ts-expect-error -- price is a number column
    grid.setCell(0, "price", "expensive");
    // @ts-expect-error -- status is a string column
    grid.setCell(0, "status", 1);
  });

  it("rejects a column that is not in the schema", () => {
    // @ts-expect-error -- no such column
    grid.setCell(0, "missing", 1);
  });
});

describe("insert", () => {
  it("takes rows matching the schema", () => {
    grid.insertRows([{ price: 1, qty: 2, status: "new" }]);
  });

  it("rejects a row with a wrong field type", () => {
    // @ts-expect-error -- qty is a number column
    grid.insertRows([{ price: 1, qty: "two", status: "new" }]);
  });

  it("rejects a row missing a column", () => {
    // @ts-expect-error -- status is required
    grid.insertRows([{ price: 1, qty: 2 }]);
  });

  it("takes typed arrays or plain arrays per column", () => {
    grid.insertColumns({
      price: new Float64Array(2),
      qty: new Int32Array(2),
      status: ["a", "b"],
    });
    grid.insertColumns({ price: [1, 2], qty: [1, 2], status: ["a", "b"] });
  });

  it("rejects a column array of the wrong element type", () => {
    // @ts-expect-error -- status holds strings
    grid.insertColumns({ price: [1], qty: [1], status: [1] });
  });
});

declare const view: DataGridView<Schema>;

describe("views", () => {
  it("types each cell by its column", () => {
    expectTypeOf(view.get(0, "price")).toEqualTypeOf<number>();
    expectTypeOf(view.get(0, "status")).toEqualTypeOf<string>();
  });

  it("types a whole row", () => {
    expectTypeOf(view.row(0)).toEqualTypeOf<Row<Schema>>();
    expectTypeOf(view.rows()).toEqualTypeOf<Row<Schema>[]>();
  });

  it("rejects an unknown column", () => {
    // @ts-expect-error -- no such column
    view.get(0, "missing");
  });
});

describe("useWasmDataGridSync, given a schema", () => {
  it("narrows the grid out of null on status", () => {
    const result = useWasmDataGridSync(schema);
    if (result.status === "ready") {
      expectTypeOf(result.grid).toEqualTypeOf<DataGridStore<Schema>>();
      expectTypeOf(result.error).toEqualTypeOf<null>();
    }
    if (result.status === "error") {
      expectTypeOf(result.error).toEqualTypeOf<Error>();
      expectTypeOf(result.grid).toEqualTypeOf<null>();
    }
  });

  it("narrows after destructuring, via isReady", () => {
    // status is gone once destructured, so isReady carries a literal type
    // in each branch to act as a second discriminant.
    const { isReady, grid: t } = useWasmDataGridSync(schema);
    if (isReady) {
      expectTypeOf(t).toEqualTypeOf<DataGridStore<Schema>>();
    }
  });

  it("types initialRows from the schema", () => {
    useWasmDataGridSync(schema, { initialRows: [{ price: 1, qty: 2, status: "new" }] });
    // @ts-expect-error -- qty is a number column
    useWasmDataGridSync(schema, { initialRows: [{ price: 1, qty: "two", status: "new" }] });
  });
});

describe("useDataGridView", () => {
  it("accepts null while the grid is loading", () => {
    assertType<DataGridView<Schema> | null>(useDataGridView<Schema>(null, 0, 10));
  });

  it("carries the schema through", () => {
    expectTypeOf(useDataGridView(grid, 0, 10)).toEqualTypeOf<DataGridView<Schema> | null>();
  });
});

describe("queries", () => {
  it("takes a sort naming a column of the schema", () => {
    grid.setQuery({ sort: [{ column: "price", direction: "desc" }] });
    grid.sortBy("qty", "asc");
    grid.sortBy("status");
  });

  it("rejects a sort on a column that is not there", () => {
    // @ts-expect-error -- no such column
    grid.setQuery({ sort: [{ column: "missing" }] });
    // @ts-expect-error -- no such column
    grid.sortBy("missing", "asc");
  });

  it("rejects a direction that is not asc or desc", () => {
    // @ts-expect-error -- not a direction
    grid.setQuery({ sort: [{ column: "price", direction: "sideways" }] });
  });

  it("types a filter value by the column it names", () => {
    grid.filter([{ column: "price", op: "gt", value: 10 }]);
    grid.filter([{ column: "price", op: "between", value: [1, 2] }]);
    grid.filter([{ column: "status", op: "eq", value: "paid" }]);
    grid.filter([{ column: "status", op: "in", value: ["paid", "new"] }]);
    grid.filter([{ column: "status", op: "contains", value: "pai" }]);
  });

  it("rejects a value of the wrong type for its column", () => {
    // @ts-expect-error -- price holds numbers
    grid.filter([{ column: "price", op: "eq", value: "ten" }]);
    // @ts-expect-error -- status holds strings
    grid.filter([{ column: "status", op: "eq", value: 1 }]);
  });

  it("allows a string operator only on a string column", () => {
    // @ts-expect-error -- contains needs a string column
    grid.filter([{ column: "price", op: "contains", value: "x" }]);
    // @ts-expect-error -- in needs a string column
    grid.filter([{ column: "qty", op: "in", value: ["1"] }]);
  });

  it("allows an ordering operator only on a number column", () => {
    // @ts-expect-error -- gt needs a number column
    grid.filter([{ column: "status", op: "gt", value: 1 }]);
    // @ts-expect-error -- between needs a number column
    grid.filter([{ column: "status", op: "between", value: [1, 2] }]);
  });

  it("takes a between as a pair", () => {
    // @ts-expect-error -- between takes two bounds
    grid.filter([{ column: "price", op: "between", value: 5 }]);
  });

  it("reads the query back with every part filled in", () => {
    expectTypeOf(grid.query).toEqualTypeOf<Required<DataGridQuery<Schema>>>();
    expectTypeOf(grid.query.search).toEqualTypeOf<string>();
  });

  it("carries the schema through useDataGridQuery", () => {
    expectTypeOf(useDataGridQuery(grid)).toEqualTypeOf<Required<DataGridQuery<Schema>> | null>();
    assertType<Required<DataGridQuery<Schema>> | null>(useDataGridQuery<Schema>(null));
  });
});

declare const asyncGrid: AsyncDataGridStore<Schema>;

describe("modes", () => {
  it("returns Promises from a worker store's mutations", () => {
    expectTypeOf(asyncGrid.setCell(0, "price", 1)).toEqualTypeOf<Promise<void>>();
    expectTypeOf(asyncGrid.insertRows([])).toEqualTypeOf<Promise<RowIds>>();
    expectTypeOf(asyncGrid.sortBy("price", "asc")).toEqualTypeOf<Promise<void>>();
  });

  it("keeps the sync store's mutations synchronous", () => {
    expectTypeOf(grid.setCell(0, "price", 1)).toEqualTypeOf<void>();
    expectTypeOf(grid.insertRows([])).toEqualTypeOf<RowIds>();
  });

  it("takes either store in the read hooks", () => {
    assertType<DataGridView<Schema> | null>(useDataGridView(asyncGrid, 0, 10));
    assertType<DataGridView<Schema> | null>(useDataGridView(grid, 0, 10));
    assertType<DataGridStats | null>(useDataGridStats(asyncGrid));
    assertType<Required<DataGridQuery<Schema>> | null>(useDataGridQuery(asyncGrid));
  });

  it("satisfies DataGridReader from both", () => {
    assertType<DataGridReader<Schema>>(asyncGrid);
    assertType<DataGridReader<Schema>>(grid);
  });
});

const Orders = defineDataGrid("orders", schema, {
  initialRows: [{ price: 1, qty: 2, status: "new" }],
});

describe("defineDataGrid", () => {
  it("infers the grid's schema from the one it is given", () => {
    expectTypeOf(Orders).toEqualTypeOf<DataGridDef<Schema>>();
    expectTypeOf(Orders.key).toEqualTypeOf<string>();
  });

  it("types initialRows from the schema", () => {
    // @ts-expect-error -- qty is a number column
    defineDataGrid("bad", schema, { initialRows: [{ price: 1, qty: "two", status: "new" }] });
    // @ts-expect-error -- status is required
    defineDataGrid("bad", schema, { initialRows: [{ price: 1, qty: 2 }] });
  });

  it("keeps the provider contract out of its type", () => {
    // @ts-expect-error -- internal: a caller names a definition, never builds one
    void Orders.pattern;
    // @ts-expect-error -- internal
    void Orders.sync;
  });

  it("is a WasmStateDef, so a provider can drop it", () => {
    assertType<WasmStateDef>(Orders);
  });
});

describe("useWasmDataGridSync", () => {
  it("gives a DataGridStore for a schema and for a definition", () => {
    expectTypeOf(useWasmDataGridSync(schema)).toEqualTypeOf<
      UseWasmDataGridResult<DataGridStore<Schema>>
    >();
    expectTypeOf(useWasmDataGridSync(Orders)).toEqualTypeOf<
      UseWasmDataGridResult<DataGridStore<Schema>>
    >();
  });

  it("takes options only with a schema", () => {
    useWasmDataGridSync(schema, { wasmUrl: "x" });
    // @ts-expect-error -- a shared grid's options are its definition's and its provider's
    useWasmDataGridSync(Orders, { wasmUrl: "x" });
    // @ts-expect-error -- the worker is the async hook's
    useWasmDataGridSync(schema, { workerUrl: "x" });
  });

  it("has no mode to choose", () => {
    // @ts-expect-error -- the hook's name is the mode
    useWasmDataGridSync(schema, { mode: "worker" });
  });
});

describe("useWasmDataGridAsync", () => {
  it("gives an AsyncDataGridStore for a schema and for a definition", () => {
    expectTypeOf(useWasmDataGridAsync(schema)).toEqualTypeOf<
      UseWasmDataGridResult<AsyncDataGridStore<Schema>>
    >();
    expectTypeOf(useWasmDataGridAsync(Orders)).toEqualTypeOf<
      UseWasmDataGridResult<AsyncDataGridStore<Schema>>
    >();
  });

  it("narrows the grid on status", () => {
    const result = useWasmDataGridAsync(Orders);
    if (result.status === "ready") {
      expectTypeOf(result.grid).toEqualTypeOf<AsyncDataGridStore<Schema>>();
      expectTypeOf(result.grid.setCell(0, "price", 1)).toEqualTypeOf<Promise<void>>();
    }
  });

  it("takes a workerUrl with a schema", () => {
    useWasmDataGridAsync(schema, { wasmUrl: "x", workerUrl: "y" });
    useWasmDataGridAsync(schema, { initialRows: [{ price: 1, qty: 2, status: "new" }] });
  });
});

describe("AnyDataGridStore", () => {
  it("is either store", () => {
    assertType<AnyDataGridStore<Schema>>(grid);
    assertType<AnyDataGridStore<Schema>>(asyncGrid);
  });

  it("lets a component that awaits every mutation drive both", async () => {
    const edit = async (store: AnyDataGridStore<Schema>) => {
      await store.setCell(0, "price", 1);
      await store.sortBy("price", "desc");
      await store.setQuery({ search: "x" });
      const ids = await store.insertRows([{ price: 1, qty: 2, status: "new" }]);
      expectTypeOf(ids).toEqualTypeOf<RowIds>();
    };
    await edit(grid);
    await edit(asyncGrid);
  });

  it("still checks columns and values", () => {
    const store = grid as AnyDataGridStore<Schema>;
    // @ts-expect-error -- price is a number column
    void store.setCell(0, "price", "expensive");
    // @ts-expect-error -- no such column
    void store.sortBy("missing");
  });

  it("reads through the read hooks", () => {
    const store = grid as AnyDataGridStore<Schema>;
    assertType<DataGridView<Schema> | null>(useDataGridView(store, 0, 10));
  });
});

describe("providers", () => {
  it("take per-pattern url overrides", () => {
    assertType(WasmStateSyncProvider({ urls: { datagrid: { wasmUrl: "x" } } }));
    assertType(WasmStateAsyncProvider({ urls: { datagrid: { wasmUrl: "x", workerUrl: "y" } } }));
  });

  it("only take a workerUrl where there is a worker", () => {
    // @ts-expect-error -- the sync provider runs no worker
    WasmStateSyncProvider({ urls: { datagrid: { workerUrl: "y" } } });
  });

  it("drop a definition, not a schema", () => {
    useWasmStateSync().drop(Orders);
    useWasmStateAsync().drop(Orders);
    // @ts-expect-error -- a schema has no key
    useWasmStateSync().drop(schema);
  });
});

describe("WasmStateError", () => {
  it("narrows on instanceof, across both entries' copies", () => {
    const caught: unknown = null;
    if (caught instanceof WasmStateError) {
      expectTypeOf(caught.code).toEqualTypeOf<WasmStateErrorCode>();
    }
  });
});
