import { assertType, describe, expectTypeOf, it } from "vitest";
import {
  defineSchema,
  useTableView,
  useWasmTable,
  type Row,
  type TableStore,
  type TableView,
} from "../src/index";

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

declare const table: TableStore<Schema>;

describe("setCell", () => {
  it("takes a value its column can hold", () => {
    table.setCell(0, "price", 1.5);
    table.setCell(0, "qty", 2);
    table.setCell(0, "status", "shipped");
  });

  it("rejects a value of the wrong type", () => {
    // @ts-expect-error -- price is a number column
    table.setCell(0, "price", "expensive");
    // @ts-expect-error -- status is a string column
    table.setCell(0, "status", 1);
  });

  it("rejects a column that is not in the schema", () => {
    // @ts-expect-error -- no such column
    table.setCell(0, "missing", 1);
  });
});

describe("insert", () => {
  it("takes rows matching the schema", () => {
    table.insertRows([{ price: 1, qty: 2, status: "new" }]);
  });

  it("rejects a row with a wrong field type", () => {
    // @ts-expect-error -- qty is a number column
    table.insertRows([{ price: 1, qty: "two", status: "new" }]);
  });

  it("rejects a row missing a column", () => {
    // @ts-expect-error -- status is required
    table.insertRows([{ price: 1, qty: 2 }]);
  });

  it("takes typed arrays or plain arrays per column", () => {
    table.insertColumns({
      price: new Float64Array(2),
      qty: new Int32Array(2),
      status: ["a", "b"],
    });
    table.insertColumns({ price: [1, 2], qty: [1, 2], status: ["a", "b"] });
  });

  it("rejects a column array of the wrong element type", () => {
    // @ts-expect-error -- status holds strings
    table.insertColumns({ price: [1], qty: [1], status: [1] });
  });
});

declare const view: TableView<Schema>;

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

describe("useWasmTable", () => {
  it("narrows the table out of null on status", () => {
    const result = useWasmTable(schema);
    if (result.status === "ready") {
      expectTypeOf(result.table).toEqualTypeOf<TableStore<Schema>>();
      expectTypeOf(result.error).toEqualTypeOf<null>();
    }
    if (result.status === "error") {
      expectTypeOf(result.error).toEqualTypeOf<Error>();
      expectTypeOf(result.table).toEqualTypeOf<null>();
    }
  });

  it("narrows after destructuring, via isReady", () => {
    // status is gone once destructured, so isReady carries a literal type
    // in each branch to act as a second discriminant.
    const { isReady, table: t } = useWasmTable(schema);
    if (isReady) {
      expectTypeOf(t).toEqualTypeOf<TableStore<Schema>>();
    }
  });

  it("types initialRows from the schema", () => {
    useWasmTable(schema, { initialRows: [{ price: 1, qty: 2, status: "new" }] });
    // @ts-expect-error -- qty is a number column
    useWasmTable(schema, { initialRows: [{ price: 1, qty: "two", status: "new" }] });
  });
});

describe("useTableView", () => {
  it("accepts null while the table is loading", () => {
    assertType<TableView<Schema> | null>(useTableView<Schema>(null, 0, 10));
  });

  it("carries the schema through", () => {
    expectTypeOf(useTableView(table, 0, 10)).toEqualTypeOf<TableView<Schema> | null>();
  });
});
