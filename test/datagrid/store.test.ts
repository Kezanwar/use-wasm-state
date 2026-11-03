import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { WasmStateError } from "../../src/index";
import { defineSchema } from "../../src/datagrid/index";
import { loadSyncEngine, type SyncGridEngine } from "../../src/datagrid/engine";
import { ENGINE_URL, serveEngine } from "../helpers/engine";

/**
 * The sync store, over the real engine. Everything past creating the grid
 * goes through the store's public API: if a test needs a handle or a
 * pointer, the API is wrong.
 */

const schema = defineSchema({ id: "i32", price: "f64", status: "string" });

beforeAll(() => serveEngine());
afterAll(() => vi.unstubAllGlobals());

async function store() {
  const engine = await loadSyncEngine({ wasmUrl: ENGINE_URL });
  return { engine, grid: engine.createGrid(schema) };
}

const ROW = (i: number) => ({ id: i, price: i + 0.5, status: i % 2 ? "shipped" : "new" });

describe("inserting", () => {
  it("takes rows as objects and gives back their ids", async () => {
    const { grid } = await store();

    const ids = grid.insertRows([ROW(0), ROW(1), ROW(2)]);
    expect(ids.first).toBe(0);
    expect(ids.length).toBe(3);
    expect([...ids]).toEqual([0, 1, 2]);
    expect(ids.at(1)).toBe(1);
    expect(ids.at(9)).toBeUndefined();
    expect(ids.toArray()).toEqual([0, 1, 2]);

    expect(grid.rowCount).toBe(3);
    expect(grid.totalRows).toBe(3);
  });

  it("carries on from the last row id", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(0), ROW(1)]);
    const second = grid.insertRows([ROW(2)]);
    expect(second.first).toBe(2);
    expect(grid.rowCount).toBe(3);
  });

  it("takes columns directly, including typed arrays", async () => {
    const { grid } = await store();

    const ids = grid.insertColumns({
      id: Int32Array.from([10, 20, 30]),
      price: Float64Array.from([1.5, 2.5, 3.5]),
      status: ["new", "shipped", "new"],
    });

    expect(ids.first).toBe(0);
    expect(ids.length).toBe(3);

    const view = grid.view(0, 3);
    expect([...view.ids]).toEqual([0, 1, 2]);
    expect(view.get(1, "id")).toBe(20);
    expect(view.get(1, "price")).toBe(2.5);
    expect(view.get(1, "status")).toBe("shipped");
  });

  it("accepts plain arrays for columns too", async () => {
    const { grid } = await store();
    grid.insertColumns({ id: [1, 2], price: [1, 2], status: ["a", "b"] });
    expect(grid.rowCount).toBe(2);
    expect(grid.view(0, 2).get(0, "status")).toBe("a");
  });

  it("rejects ragged columns with a typed error", async () => {
    const { grid } = await store();
    try {
      grid.insertColumns({ id: [1, 2], price: [1], status: ["a", "b"] });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(WasmStateError);
      expect((err as WasmStateError).code).toBe("row-count");
      expect((err as WasmStateError).op).toBe("insertColumns");
      expect((err as WasmStateError).status).toBe(-5);
    }
    expect(grid.rowCount).toBe(0);
  });
});

describe("reading", () => {
  it("clamps a window and reports where it really starts", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(0), ROW(1), ROW(2), ROW(3)]);

    expect(grid.view(0, 2).length).toBe(2);
    expect(grid.view(2, 10).length).toBe(2);
    expect(grid.view(2, 10).start).toBe(2);
    expect(grid.view(99, 10).length).toBe(0);
    expect(grid.view(99, 10).start).toBe(4);
    expect(grid.view(-5, 2).start).toBe(0);
  });

  it("builds row objects only when asked", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(0), ROW(1)]);

    const view = grid.view(0, 2);
    expect(view.row(0)).toEqual({ id: 0, price: 0.5, status: "new" });
    expect(view.rows()).toEqual([
      { id: 0, price: 0.5, status: "new" },
      { id: 1, price: 1.5, status: "shipped" },
    ]);
  });

  it("throws for a column that is not in the schema", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(0)]);
    // @ts-expect-error -- not a column of this schema
    expect(() => grid.view(0, 1).get(0, "nope")).toThrowError(/no column named/);
  });
});

describe("editing", () => {
  it("writes each column type by name", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(0), ROW(1)]);

    grid.setCell(1, "id", 99);
    grid.setCell(1, "price", 9.75);
    grid.setCell(1, "status", "cancelled");

    const view = grid.view(0, 2);
    expect(view.get(1, "id")).toBe(99);
    expect(view.get(1, "price")).toBe(9.75);
    expect(view.get(1, "status")).toBe("cancelled");
  });

  it("writes a whole number into an f64 column as a float", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(0)]);
    // The column kind comes from the schema, not from the value: guessing
    // i32 because 7 is a whole number would truncate the column.
    grid.setCell(0, "price", 7);
    expect(grid.view(0, 1).get(0, "price")).toBe(7);
    grid.setCell(0, "price", 7.25);
    expect(grid.view(0, 1).get(0, "price")).toBe(7.25);
  });

  it("reports a deleted row as a typed error", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(0), ROW(1)]);
    grid.deleteRows([1]);

    try {
      grid.setCell(1, "id", 5);
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as WasmStateError).code).toBe("row-deleted");
      expect((err as WasmStateError).op).toBe("setCell");
    }
  });

  it("deletes without moving surviving row ids", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(0), ROW(1), ROW(2), ROW(3)]);

    grid.deleteRows([0, 2]);
    expect(grid.rowCount).toBe(2);
    expect(grid.totalRows).toBe(4);

    const view = grid.view(0, 10);
    expect([...view.ids]).toEqual([1, 3]);
    expect(view.get(0, "id")).toBe(1);
  });
});

describe("the dictionary mirror", () => {
  it("resolves strings inserted in bulk", async () => {
    const { grid } = await store();
    const labels = ["new", "paid", "picked", "shipped"];
    grid.insertColumns({
      id: labels.map((_, i) => i),
      price: labels.map((_, i) => i),
      status: labels,
    });

    const view = grid.view(0, 4);
    expect(view.rows().map((r) => r.status)).toEqual(labels);
  });

  it("picks up a string an edit introduced", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(0), ROW(1)]);

    grid.setCell(0, "status", "a value the column has never held");
    expect(grid.view(0, 1).get(0, "status")).toBe("a value the column has never held");
  });

  it("picks up strings a later insert introduced", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(0)]);
    grid.insertRows([{ id: 1, price: 1, status: "later" }]);
    expect(grid.view(1, 1).get(0, "status")).toBe("later");
  });

  it("keeps resolving values it already knew", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(0), ROW(1)]);
    grid.setCell(0, "status", "brand new");
    // The mirror is appended to, never rebuilt, so the original entries
    // must still mean what they did.
    expect(grid.view(1, 1).get(0, "status")).toBe("shipped");
  });
});

describe("view caching", () => {
  it("returns the identical object for the same window and revision", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(0), ROW(1), ROW(2)]);

    const first = grid.view(0, 2);
    expect(grid.view(0, 2)).toBe(first);
  });

  it("returns a new object once the revision moves", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(0), ROW(1)]);

    const before = grid.view(0, 2);
    grid.setCell(0, "id", 42);
    const after = grid.view(0, 2);

    expect(after).not.toBe(before);
    expect(after.get(0, "id")).toBe(42);
  });

  it("returns a new object for a different window", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(0), ROW(1), ROW(2)]);

    const first = grid.view(0, 2);
    const moved = grid.view(1, 2);
    expect(moved).not.toBe(first);
    // Only the most recent window is kept, so going back re-reads.
    expect(grid.view(0, 2)).not.toBe(first);
  });
});

describe("subscriptions", () => {
  it("notifies after a mutation that changed something", async () => {
    const { grid } = await store();
    const listener = vi.fn();
    grid.subscribe(listener);

    grid.insertRows([ROW(0)]);
    expect(listener).toHaveBeenCalledTimes(1);

    grid.setCell(0, "id", 9);
    expect(listener).toHaveBeenCalledTimes(2);

    grid.deleteRows([0]);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("stays quiet for a mutation that changed nothing", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(0)]);

    const listener = vi.fn();
    grid.subscribe(listener);

    // Nothing to do, so nothing to re-render.
    grid.insertRows([]);
    grid.deleteRows([]);
    grid.insertColumns({ id: [], price: [], status: [] });
    expect(listener).not.toHaveBeenCalled();
  });

  it("stays quiet for a rejected mutation", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(0)]);

    const listener = vi.fn();
    grid.subscribe(listener);

    expect(() => grid.setCell(99, "id", 1)).toThrow();
    expect(listener).not.toHaveBeenCalled();
    expect(grid.revision).toBe(1);
  });

  it("stops notifying after unsubscribe", async () => {
    const { grid } = await store();
    const listener = vi.fn();
    const off = grid.subscribe(listener);

    grid.insertRows([ROW(0)]);
    off();
    grid.insertRows([ROW(1)]);

    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("disposal", () => {
  it("makes every later call throw", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(0)]);
    grid.dispose();

    const calls: Array<[string, () => unknown]> = [
      ["insertRows", () => grid.insertRows([ROW(1)])],
      ["insertColumns", () => grid.insertColumns({ id: [1], price: [1], status: ["a"] })],
      ["setCell", () => grid.setCell(0, "id", 1)],
      ["deleteRows", () => grid.deleteRows([0])],
      ["view", () => grid.view(0, 1)],
      ["revision", () => grid.revision],
      ["rowCount", () => grid.rowCount],
      ["totalRows", () => grid.totalRows],
    ];

    for (const [name, call] of calls) {
      try {
        call();
        expect.unreachable(`${name} should have thrown`);
      } catch (err) {
        expect(err, name).toBeInstanceOf(WasmStateError);
        expect((err as WasmStateError).code, name).toBe("disposed");
      }
    }
  });

  it("can be disposed twice", async () => {
    const { grid } = await store();
    grid.dispose();
    expect(() => grid.dispose()).not.toThrow();
  });

  it("drops every grid when the engine goes", async () => {
    const engine = await loadSyncEngine({ wasmUrl: ENGINE_URL });
    const a = engine.createGrid(schema);
    const b = engine.createGrid(schema);
    a.insertRows([ROW(0)]);

    engine.dispose();

    expect(() => a.view(0, 1)).toThrowError(WasmStateError);
    expect(() => b.view(0, 1)).toThrowError(WasmStateError);
    expect(() => engine.createGrid(schema)).toThrowError(/disposed/);
  });

  it("keeps two grids in one engine independent", async () => {
    const engine: SyncGridEngine = await loadSyncEngine({ wasmUrl: ENGINE_URL });
    const a = engine.createGrid(schema);
    const b = engine.createGrid(schema);

    a.insertRows([ROW(0), ROW(1)]);
    expect(a.rowCount).toBe(2);
    expect(b.rowCount).toBe(0);
    expect(b.revision).toBe(0);
  });
});

describe("appending", () => {
  it("adds rows one at a time through insertRows and insertColumns", async () => {
    const { grid } = await store();
    grid.insertColumns({
      id: [0, 1, 2],
      price: [0.5, 1.5, 2.5],
      status: ["new", "shipped", "new"],
    });

    expect(grid.insertRows([ROW(3)]).first).toBe(3);
    expect(grid.insertColumns({ id: [4], price: [4.5], status: ["held"] }).first).toBe(4);
    expect(grid.insertRows([ROW(5), ROW(6)]).first).toBe(5);

    expect(grid.rowCount).toBe(7);
    expect(grid.view(3, 4).rows()).toEqual([
      ROW(3),
      { id: 4, price: 4.5, status: "held" },
      ROW(5),
      ROW(6),
    ]);
  });

  it("places an append where the active query puts it", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(1), ROW(2), ROW(3)]);
    grid.setQuery({ sort: [{ column: "price", direction: "desc" }] });

    grid.insertRows([ROW(9)]);
    expect(
      grid
        .view(0, 4)
        .rows()
        .map((row) => row.id)
    ).toEqual([9, 3, 2, 1]);

    grid.setQuery({ filters: [{ column: "status", op: "eq", value: "new" }] });
    grid.insertRows([ROW(10), ROW(11)]);
    expect(
      grid
        .view(0, 10)
        .rows()
        .map((row) => row.id)
    ).toEqual([2, 10]);
  });

  it("leaves the grid and its listeners untouched when an append is rejected", async () => {
    const { grid } = await store();
    grid.insertRows([ROW(0), ROW(1)]);
    const revision = grid.revision;
    const listener = vi.fn();
    grid.subscribe(listener);

    expect(() => grid.insertColumns({ id: [7, 8], price: [1], status: ["x", "y"] })).toThrow(
      WasmStateError
    );

    expect(grid.totalRows).toBe(2);
    expect(grid.revision).toBe(revision);
    expect(listener).not.toHaveBeenCalled();
    expect(grid.view(0, 5).rows()).toEqual([ROW(0), ROW(1)]);
    expect(grid.insertRows([ROW(2)]).first).toBe(2);
  });
});

describe("at scale", () => {
  it("loads 200k rows through insertColumns and reads windows", async () => {
    const { grid } = await store();
    const n = 200_000;
    const labels = ["new", "paid", "picked", "shipped", "held", "cancelled"];

    const id = new Int32Array(n);
    const price = new Float64Array(n);
    const status: string[] = new Array(n);
    for (let i = 0; i < n; i++) {
      id[i] = i;
      price[i] = i + 0.5;
      status[i] = labels[i % labels.length]!;
    }

    const ids = grid.insertColumns({ id, price, status });
    expect(ids.length).toBe(n);
    expect(grid.rowCount).toBe(n);

    for (const start of [0, n / 2, n - 50]) {
      const view = grid.view(start, 50);
      expect(view.length, `start ${start}`).toBe(50);
      expect(view.get(0, "id")).toBe(start);
      expect(view.get(0, "status")).toBe(labels[start % labels.length]);
    }

    // An append after the load costs a row, not the dataset.
    grid.insertRows([{ id: -1, price: 0, status: "new" }]);
    const started = performance.now();
    for (let i = 0; i < 1000; i++) grid.insertRows([{ id: n + i, price: 1, status: "paid" }]);
    expect((performance.now() - started) / 1000).toBeLessThan(0.2);
    expect(grid.view(n + 1000, 1).row(0)).toEqual({ id: n + 999, price: 1, status: "paid" });
  });
});
