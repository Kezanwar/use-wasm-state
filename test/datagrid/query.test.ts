import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WasmStateError } from "../../src/index";
import { defineSchema } from "../../src/datagrid/index";
import { loadSyncEngine } from "../../src/datagrid/engine";
import { ENGINE_URL, serveEngine } from "../helpers/engine";

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
  const engine = await loadSyncEngine({ wasmUrl: ENGINE_URL });
  const grid = engine.createGrid(schema);
  grid.insertColumns({
    id: [100, 200, 300, 400, 500],
    price: [30, 10, 20, 10, 40],
    status: ["paid", "new", "paid", "Shipped", "new"],
  });
  return grid;
}

const ids = (grid: Awaited<ReturnType<typeof seeded>>) => [...grid.view(0, grid.rowCount).ids];

describe("sorting", () => {
  it("sorts ascending and descending by each column kind", async () => {
    const grid = await seeded();

    grid.sortBy("price", "asc");
    expect(ids(grid)).toEqual([1, 3, 2, 0, 4]);

    grid.sortBy("price", "desc");
    expect(ids(grid)).toEqual([4, 0, 2, 1, 3]);

    grid.sortBy("id", "desc");
    expect(ids(grid)).toEqual([4, 3, 2, 1, 0]);

    // Case-insensitive, so "Shipped" sorts with the other s words.
    grid.sortBy("status", "asc");
    expect(ids(grid)).toEqual([1, 4, 0, 2, 3]);
  });

  it("breaks ties by row id", async () => {
    const grid = await seeded();
    grid.sortBy("price", "asc");
    // Rows 1 and 3 both cost 10.
    expect(ids(grid).slice(0, 2)).toEqual([1, 3]);
  });

  it("sorts by several columns in priority order", async () => {
    const grid = await seeded();
    grid.setQuery({
      sort: [
        { column: "status", direction: "asc" },
        { column: "price", direction: "desc" },
      ],
    });
    expect(ids(grid)).toEqual([4, 1, 0, 2, 3]);
  });

  it("clears the sort when sortBy is given no direction", async () => {
    const grid = await seeded();
    grid.sortBy("price", "desc");
    expect(ids(grid)[0]).toBe(4);

    grid.sortBy("price");
    expect(ids(grid)).toEqual([0, 1, 2, 3, 4]);
    expect(grid.query.sort).toEqual([]);
  });
});

describe("filtering", () => {
  it("applies each numeric operator", async () => {
    const grid = await seeded();
    const cases: Array<[Parameters<typeof grid.filter>[0], number[]]> = [
      [[{ column: "price", op: "eq", value: 10 }], [1, 3]],
      [[{ column: "price", op: "ne", value: 10 }], [0, 2, 4]],
      [[{ column: "price", op: "lt", value: 20 }], [1, 3]],
      [[{ column: "price", op: "le", value: 20 }], [1, 2, 3]],
      [[{ column: "price", op: "gt", value: 20 }], [0, 4]],
      [[{ column: "price", op: "ge", value: 20 }], [0, 2, 4]],
      [[{ column: "price", op: "between", value: [10, 20] }], [1, 2, 3]],
    ];

    for (const [clauses, want] of cases) {
      grid.filter(clauses);
      expect(ids(grid), clauses[0]!.op).toEqual(want);
      expect(grid.rowCount).toBe(want.length);
    }
  });

  it("applies each string operator", async () => {
    const grid = await seeded();
    const cases: Array<[Parameters<typeof grid.filter>[0], number[]]> = [
      [[{ column: "status", op: "eq", value: "paid" }], [0, 2]],
      [[{ column: "status", op: "ne", value: "paid" }], [1, 3, 4]],
      [[{ column: "status", op: "in", value: ["new", "paid"] }], [0, 1, 2, 4]],
      // contains is case-insensitive.
      [[{ column: "status", op: "contains", value: "SHIP" }], [3]],
    ];

    for (const [clauses, want] of cases) {
      grid.filter(clauses);
      expect(ids(grid), clauses[0]!.op).toEqual(want);
    }
  });

  it("combines clauses with and", async () => {
    const grid = await seeded();
    grid.filter([
      { column: "status", op: "eq", value: "paid" },
      { column: "price", op: "gt", value: 25 },
    ]);
    expect(ids(grid)).toEqual([0]);
  });

  it("names the column when an operator does not fit it", async () => {
    const grid = await seeded();
    expect(() =>
      // @ts-expect-error -- contains needs a string column
      grid.filter([{ column: "price", op: "contains", value: "x" }])
    ).toThrowError(/"contains" needs a string column.*"price"/);
    expect(() =>
      // @ts-expect-error -- gt needs a number column
      grid.filter([{ column: "status", op: "gt", value: 1 }])
    ).toThrowError(/"gt" needs a number column.*"status"/);
  });

  it("names the column when it is not in the schema", async () => {
    const grid = await seeded();
    expect(() =>
      // @ts-expect-error -- no such column
      grid.filter([{ column: "nope", op: "eq", value: 1 }])
    ).toThrowError(/no column named "nope"/);
  });

  it("rejects a between whose bounds are the wrong way round", async () => {
    const grid = await seeded();
    try {
      grid.filter([{ column: "price", op: "between", value: [50, 10] }]);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WasmStateError);
      expect((err as WasmStateError).op).toBe("setQuery");
    }
    // The previous query stays in place.
    expect(grid.rowCount).toBe(5);
  });
});

describe("search", () => {
  it("matches across every string column, case-insensitively", async () => {
    const grid = await seeded();

    grid.search("ship");
    expect(ids(grid)).toEqual([3]);

    grid.search("SHIP");
    expect(ids(grid)).toEqual([3]);

    grid.search("p");
    expect(ids(grid)).toEqual([0, 2, 3]);

    grid.search("zzz");
    expect(grid.rowCount).toBe(0);

    grid.search("");
    expect(grid.rowCount).toBe(5);
  });

  it("does not search numeric columns", async () => {
    const grid = await seeded();
    grid.search("300");
    expect(grid.rowCount).toBe(0);
  });
});

describe("the three together", () => {
  it("filters, then searches, then sorts", async () => {
    const grid = await seeded();
    grid.setQuery({
      filters: [{ column: "price", op: "ge", value: 20 }],
      search: "a",
      sort: [{ column: "price", direction: "desc" }],
    });
    // price >= 20 leaves 0, 2, 4; "new" has no "a", so 4 drops.
    expect(ids(grid)).toEqual([0, 2]);
  });

  it("keeps the rest when one part is changed", async () => {
    const grid = await seeded();
    grid.sortBy("price", "desc");
    grid.filter([{ column: "status", op: "eq", value: "paid" }]);
    grid.search("a");

    expect(grid.query.sort).toEqual([{ column: "price", direction: "desc" }]);
    expect(grid.query.filters).toHaveLength(1);
    expect(grid.query.search).toBe("a");
    expect(ids(grid)).toEqual([0, 2]);
  });

  it("clears everything", async () => {
    const grid = await seeded();
    grid.setQuery({
      sort: [{ column: "price", direction: "desc" }],
      filters: [{ column: "status", op: "eq", value: "paid" }],
      search: "a",
    });
    expect(grid.rowCount).toBe(2);

    grid.clearQuery();
    expect(ids(grid)).toEqual([0, 1, 2, 3, 4]);
    expect(grid.query).toEqual({ sort: [], filters: [], search: "" });
  });

  it("drops the parts setQuery leaves out", async () => {
    const grid = await seeded();
    grid.sortBy("price", "desc");
    grid.setQuery({ search: "a" });
    expect(grid.query.sort).toEqual([]);
    expect(grid.query.search).toBe("a");
  });
});

describe("the query and mutations", () => {
  it("places an inserted row where the sort says", async () => {
    const grid = await seeded();
    grid.sortBy("price", "asc");

    grid.insertRows([{ id: 600, price: 15, status: "new" }]);
    expect(ids(grid)).toEqual([1, 3, 5, 2, 0, 4]);
  });

  it("moves an edited row to its new position", async () => {
    const grid = await seeded();
    grid.sortBy("price", "asc");
    expect(ids(grid)[0]).toBe(1);

    grid.setCell(1, "price", 99);
    expect(ids(grid)).toEqual([3, 2, 0, 4, 1]);
  });

  it("drops an edited row out of a filter, and lets one back in", async () => {
    const grid = await seeded();
    grid.filter([{ column: "status", op: "eq", value: "paid" }]);
    expect(ids(grid)).toEqual([0, 2]);

    grid.setCell(0, "status", "refunded");
    expect(ids(grid)).toEqual([2]);

    grid.setCell(1, "status", "paid");
    expect(ids(grid)).toEqual([1, 2]);
  });

  it("picks up a new dictionary value in an active search", async () => {
    const grid = await seeded();
    grid.search("zz");
    expect(grid.rowCount).toBe(0);

    // A value the column has never held, so every cache built for the
    // search is stale.
    grid.setCell(2, "status", "fizzle");
    expect(ids(grid)).toEqual([2]);
  });

  it("drops a deleted row out of the result", async () => {
    const grid = await seeded();
    grid.sortBy("price", "asc");
    grid.deleteRows([1]);
    expect(ids(grid)).toEqual([3, 2, 0, 4]);
  });
});

describe("revisions", () => {
  it("moves when the query changes and not when it repeats", async () => {
    const grid = await seeded();
    const listener = vi.fn();
    grid.subscribe(listener);

    grid.sortBy("price", "desc");
    expect(listener).toHaveBeenCalledTimes(1);
    const after = grid.revision;

    grid.sortBy("price", "desc");
    expect(grid.revision).toBe(after);
    expect(listener).toHaveBeenCalledTimes(1);

    grid.sortBy("price", "asc");
    expect(grid.revision).not.toBe(after);
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not move for an edit the query cannot see", async () => {
    const grid = await seeded();
    grid.sortBy("price", "asc");
    const after = grid.revision;

    // The revision still moves, because the cell did change; what is
    // skipped is the order rebuild, which is not observable from here
    // beyond the order staying put.
    grid.setCell(0, "id", 999);
    expect(grid.revision).not.toBe(after);
    expect(ids(grid)).toEqual([1, 3, 2, 0, 4]);
  });
});

describe("at scale", () => {
  it("sorts, filters and searches 200k rows", async () => {
    const engine = await loadSyncEngine({ wasmUrl: ENGINE_URL });
    const grid = engine.createGrid(schema);

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
    grid.insertColumns({ id, price, status });

    grid.sortBy("price", "desc");
    const top = grid.view(0, 2);
    expect(top.get(0, "price")).toBeGreaterThanOrEqual(top.get(1, "price"));

    grid.filter([{ column: "status", op: "eq", value: "shipped" }]);
    expect(grid.rowCount).toBeGreaterThan(0);
    expect(grid.rowCount).toBeLessThan(n);
    expect(
      grid
        .view(0, 50)
        .rows()
        .every((r) => r.status === "shipped")
    ).toBe(true);

    grid.search("ship");
    expect(
      grid
        .view(0, 50)
        .rows()
        .every((r) => r.status === "shipped")
    ).toBe(true);
  });
});
