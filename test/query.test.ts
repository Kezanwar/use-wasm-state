import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createEngine, defineSchema, WasmStateError } from "../src/index";
import { ENGINE_URL, serveEngine } from "./helpers/engine";

/**
 * Sort, filter and search through the public API, over the real engine.
 */

const schema = defineSchema({ id: "i32", price: "f64", status: "string" });

beforeAll(() => serveEngine());
afterAll(() => vi.unstubAllGlobals());

//  row  id   price  status
//   0   100   30     paid
//   1   200   10     new
//   2   300   20     paid
//   3   400   10     Shipped
//   4   500   40     new
async function seeded() {
  const engine = await createEngine({ wasmUrl: ENGINE_URL });
  const table = engine.createTable(schema);
  table.insertColumns({
    id: [100, 200, 300, 400, 500],
    price: [30, 10, 20, 10, 40],
    status: ["paid", "new", "paid", "Shipped", "new"],
  });
  return table;
}

const ids = (table: Awaited<ReturnType<typeof seeded>>) => [...table.view(0, table.rowCount).ids];

describe("sorting", () => {
  it("sorts ascending and descending by each column kind", async () => {
    const table = await seeded();

    table.sortBy("price", "asc");
    expect(ids(table)).toEqual([1, 3, 2, 0, 4]);

    table.sortBy("price", "desc");
    expect(ids(table)).toEqual([4, 0, 2, 1, 3]);

    table.sortBy("id", "desc");
    expect(ids(table)).toEqual([4, 3, 2, 1, 0]);

    // Byte order, so an uppercase letter sorts before a lowercase one.
    table.sortBy("status", "asc");
    expect(ids(table)).toEqual([3, 1, 4, 0, 2]);
  });

  it("breaks ties by row id", async () => {
    const table = await seeded();
    table.sortBy("price", "asc");
    // Rows 1 and 3 both cost 10.
    expect(ids(table).slice(0, 2)).toEqual([1, 3]);
  });

  it("sorts by several columns in priority order", async () => {
    const table = await seeded();
    table.setQuery({
      sort: [
        { column: "status", direction: "asc" },
        { column: "price", direction: "desc" },
      ],
    });
    expect(ids(table)).toEqual([3, 4, 1, 0, 2]);
  });

  it("clears the sort when sortBy is given no direction", async () => {
    const table = await seeded();
    table.sortBy("price", "desc");
    expect(ids(table)[0]).toBe(4);

    table.sortBy("price");
    expect(ids(table)).toEqual([0, 1, 2, 3, 4]);
    expect(table.query.sort).toEqual([]);
  });
});

describe("filtering", () => {
  it("applies each numeric operator", async () => {
    const table = await seeded();
    const cases: Array<[Parameters<typeof table.filter>[0], number[]]> = [
      [[{ column: "price", op: "eq", value: 10 }], [1, 3]],
      [[{ column: "price", op: "ne", value: 10 }], [0, 2, 4]],
      [[{ column: "price", op: "lt", value: 20 }], [1, 3]],
      [[{ column: "price", op: "le", value: 20 }], [1, 2, 3]],
      [[{ column: "price", op: "gt", value: 20 }], [0, 4]],
      [[{ column: "price", op: "ge", value: 20 }], [0, 2, 4]],
      [[{ column: "price", op: "between", value: [10, 20] }], [1, 2, 3]],
    ];

    for (const [clauses, want] of cases) {
      table.filter(clauses);
      expect(ids(table), clauses[0]!.op).toEqual(want);
      expect(table.rowCount).toBe(want.length);
    }
  });

  it("applies each string operator", async () => {
    const table = await seeded();
    const cases: Array<[Parameters<typeof table.filter>[0], number[]]> = [
      [[{ column: "status", op: "eq", value: "paid" }], [0, 2]],
      [[{ column: "status", op: "ne", value: "paid" }], [1, 3, 4]],
      [[{ column: "status", op: "in", value: ["new", "paid"] }], [0, 1, 2, 4]],
      // contains is case-insensitive.
      [[{ column: "status", op: "contains", value: "SHIP" }], [3]],
    ];

    for (const [clauses, want] of cases) {
      table.filter(clauses);
      expect(ids(table), clauses[0]!.op).toEqual(want);
    }
  });

  it("combines clauses with and", async () => {
    const table = await seeded();
    table.filter([
      { column: "status", op: "eq", value: "paid" },
      { column: "price", op: "gt", value: 25 },
    ]);
    expect(ids(table)).toEqual([0]);
  });

  it("names the column when an operator does not fit it", async () => {
    const table = await seeded();
    expect(() =>
      // @ts-expect-error -- contains needs a string column
      table.filter([{ column: "price", op: "contains", value: "x" }])
    ).toThrowError(/"contains" needs a string column.*"price"/);
    expect(() =>
      // @ts-expect-error -- gt needs a number column
      table.filter([{ column: "status", op: "gt", value: 1 }])
    ).toThrowError(/"gt" needs a number column.*"status"/);
  });

  it("names the column when it is not in the schema", async () => {
    const table = await seeded();
    expect(() =>
      // @ts-expect-error -- no such column
      table.filter([{ column: "nope", op: "eq", value: 1 }])
    ).toThrowError(/no column named "nope"/);
  });

  it("rejects a between whose bounds are the wrong way round", async () => {
    const table = await seeded();
    try {
      table.filter([{ column: "price", op: "between", value: [50, 10] }]);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WasmStateError);
      expect((err as WasmStateError).op).toBe("setQuery");
    }
    // The previous query stays in place.
    expect(table.rowCount).toBe(5);
  });
});

describe("search", () => {
  it("matches across every string column, case-insensitively", async () => {
    const table = await seeded();

    table.search("ship");
    expect(ids(table)).toEqual([3]);

    table.search("SHIP");
    expect(ids(table)).toEqual([3]);

    table.search("p");
    expect(ids(table)).toEqual([0, 2, 3]);

    table.search("zzz");
    expect(table.rowCount).toBe(0);

    table.search("");
    expect(table.rowCount).toBe(5);
  });

  it("does not search numeric columns", async () => {
    const table = await seeded();
    table.search("300");
    expect(table.rowCount).toBe(0);
  });
});

describe("the three together", () => {
  it("filters, then searches, then sorts", async () => {
    const table = await seeded();
    table.setQuery({
      filters: [{ column: "price", op: "ge", value: 20 }],
      search: "a",
      sort: [{ column: "price", direction: "desc" }],
    });
    // price >= 20 leaves 0, 2, 4; "new" has no "a", so 4 drops.
    expect(ids(table)).toEqual([0, 2]);
  });

  it("keeps the rest when one part is changed", async () => {
    const table = await seeded();
    table.sortBy("price", "desc");
    table.filter([{ column: "status", op: "eq", value: "paid" }]);
    table.search("a");

    expect(table.query.sort).toEqual([{ column: "price", direction: "desc" }]);
    expect(table.query.filters).toHaveLength(1);
    expect(table.query.search).toBe("a");
    expect(ids(table)).toEqual([0, 2]);
  });

  it("clears everything", async () => {
    const table = await seeded();
    table.setQuery({
      sort: [{ column: "price", direction: "desc" }],
      filters: [{ column: "status", op: "eq", value: "paid" }],
      search: "a",
    });
    expect(table.rowCount).toBe(2);

    table.clearQuery();
    expect(ids(table)).toEqual([0, 1, 2, 3, 4]);
    expect(table.query).toEqual({ sort: [], filters: [], search: "" });
  });

  it("drops the parts setQuery leaves out", async () => {
    const table = await seeded();
    table.sortBy("price", "desc");
    table.setQuery({ search: "a" });
    expect(table.query.sort).toEqual([]);
    expect(table.query.search).toBe("a");
  });
});

describe("the query and mutations", () => {
  it("places an inserted row where the sort says", async () => {
    const table = await seeded();
    table.sortBy("price", "asc");

    table.insertRows([{ id: 600, price: 15, status: "new" }]);
    expect(ids(table)).toEqual([1, 3, 5, 2, 0, 4]);
  });

  it("moves an edited row to its new position", async () => {
    const table = await seeded();
    table.sortBy("price", "asc");
    expect(ids(table)[0]).toBe(1);

    table.setCell(1, "price", 99);
    expect(ids(table)).toEqual([3, 2, 0, 4, 1]);
  });

  it("drops an edited row out of a filter, and lets one back in", async () => {
    const table = await seeded();
    table.filter([{ column: "status", op: "eq", value: "paid" }]);
    expect(ids(table)).toEqual([0, 2]);

    table.setCell(0, "status", "refunded");
    expect(ids(table)).toEqual([2]);

    table.setCell(1, "status", "paid");
    expect(ids(table)).toEqual([1, 2]);
  });

  it("picks up a new dictionary value in an active search", async () => {
    const table = await seeded();
    table.search("zz");
    expect(table.rowCount).toBe(0);

    // A value the column has never held, so every cache built for the
    // search is stale.
    table.setCell(2, "status", "fizzle");
    expect(ids(table)).toEqual([2]);
  });

  it("drops a deleted row out of the result", async () => {
    const table = await seeded();
    table.sortBy("price", "asc");
    table.deleteRows([1]);
    expect(ids(table)).toEqual([3, 2, 0, 4]);
  });
});

describe("revisions", () => {
  it("moves when the query changes and not when it repeats", async () => {
    const table = await seeded();
    const listener = vi.fn();
    table.subscribe(listener);

    table.sortBy("price", "desc");
    expect(listener).toHaveBeenCalledTimes(1);
    const after = table.revision;

    table.sortBy("price", "desc");
    expect(table.revision).toBe(after);
    expect(listener).toHaveBeenCalledTimes(1);

    table.sortBy("price", "asc");
    expect(table.revision).not.toBe(after);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not move for an edit the query cannot see", async () => {
    const table = await seeded();
    table.sortBy("price", "asc");
    const after = table.revision;

    // The revision still moves, because the cell did change; what is
    // skipped is the order rebuild, which is not observable from here
    // beyond the order staying put.
    table.setCell(0, "id", 999);
    expect(table.revision).not.toBe(after);
    expect(ids(table)).toEqual([1, 3, 2, 0, 4]);
  });
});

describe("at scale", () => {
  it("sorts, filters and searches 200k rows", async () => {
    const engine = await createEngine({ wasmUrl: ENGINE_URL });
    const table = engine.createTable(schema);

    const n = 200_000;
    const labels = ["new", "paid", "picked", "shipped", "held", "cancelled"];
    const id = new Int32Array(n);
    const price = new Float64Array(n);
    const status: string[] = new Array(n);
    for (let i = 0; i < n; i++) {
      id[i] = (i * 7919) % n;
      price[i] = ((i * 31) % 100_000) / 100;
      status[i] = labels[(i * 13) % labels.length]!;
    }
    table.insertColumns({ id, price, status });

    table.sortBy("price", "desc");
    const top = table.view(0, 2);
    expect(top.get(0, "price")).toBeGreaterThanOrEqual(top.get(1, "price"));

    table.filter([{ column: "status", op: "eq", value: "shipped" }]);
    expect(table.rowCount).toBeGreaterThan(0);
    expect(table.rowCount).toBeLessThan(n);
    expect(
      table
        .view(0, 50)
        .rows()
        .every((r) => r.status === "shipped")
    ).toBe(true);

    table.search("ship");
    expect(
      table
        .view(0, 50)
        .rows()
        .every((r) => r.status === "shipped")
    ).toBe(true);
  });
});
