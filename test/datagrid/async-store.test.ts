import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defineSchema } from "../../src/datagrid/index";
import { createAsyncDataGridStore } from "../../src/datagrid/async-store";
import { WorkerClient } from "../../src/datagrid/worker-client";
import { ENGINE_URL, serveEngine } from "../helpers/engine";
import { stubWorker, workers } from "../helpers/fake-worker";

/**
 * The worker store, over a fake Worker.
 *
 * Node has no Worker, so one is stubbed that routes postMessage into the
 * real host and its replies back. Everything below the transport is the
 * code that ships: the same host, the same store, the same engine.
 */

const schema = defineSchema({ id: "i32", price: "f64", status: "string" });

beforeAll(() => {
  serveEngine();
  stubWorker();
});

afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  workers.length = 0;
});

async function store() {
  const client = new WorkerClient({ wasmUrl: ENGINE_URL });
  await client.ready();
  const grid = createAsyncDataGridStore(client, client.createGrid(schema.columns), schema);
  return { client, grid };
}

async function seeded() {
  const { client, grid } = await store();
  await grid.insertColumns({
    id: [100, 200, 300, 400, 500],
    price: [30, 10, 20, 10, 40],
    status: ["paid", "new", "paid", "Shipped", "new"],
  });
  return { client, grid };
}

const ids = (view: { ids: Int32Array }) => [...view.ids];

describe("mutations", () => {
  it("inserts rows and resolves to their ids", async () => {
    const { grid } = await store();
    const result = await grid.insertRows([
      { id: 1, price: 1.5, status: "new" },
      { id: 2, price: 2.5, status: "paid" },
    ]);

    expect(result.first).toBe(0);
    expect(result.length).toBe(2);
    expect([...result]).toEqual([0, 1]);
    expect(grid.rowCount).toBe(2);
  });

  it("inserts columns and resolves to their ids", async () => {
    const { grid } = await seeded();
    const result = await grid.insertColumns({
      id: Int32Array.from([600]),
      price: Float64Array.from([5]),
      status: ["new"],
    });
    expect(result.first).toBe(5);
    expect(grid.rowCount).toBe(6);
  });

  it("does not detach the caller's arrays", async () => {
    const { grid } = await store();
    const id = Int32Array.from([1, 2]);
    const price = Float64Array.from([1, 2]);

    await grid.insertColumns({ id, price, status: ["a", "b"] });

    // Transferring the caller's own buffers would empty them underneath
    // an API that reads like a value.
    expect(id.length).toBe(2);
    expect(price.length).toBe(2);
    expect([...id]).toEqual([1, 2]);
  });

  it("sets a cell and the row count survives", async () => {
    const { grid } = await seeded();
    await grid.setCell(0, "price", 99);
    grid.watch(0, 5);
    await vi.waitFor(() => expect(grid.view(0, 5).get(0, "price")).toBe(99));
  });

  it("deletes rows", async () => {
    const { grid } = await seeded();
    await grid.deleteRows([1, 3]);
    expect(grid.rowCount).toBe(3);
    expect(grid.totalRows).toBe(5);
  });

  it("rejects with a typed error, with the code intact", async () => {
    const { grid } = await seeded();
    await expect(grid.setCell(999, "price", 1)).rejects.toMatchObject({
      name: "WasmStateError",
      code: "out-of-range",
      status: -2,
      op: "setCell",
    });
  });
});

describe("queries", () => {
  it("sorts, filters and searches", async () => {
    const { grid } = await seeded();
    grid.watch(0, 5);

    await grid.sortBy("price", "desc");
    await vi.waitFor(() => expect(ids(grid.view(0, 5))).toEqual([4, 0, 2, 1, 3]));

    await grid.filter([{ column: "status", op: "eq", value: "paid" }]);
    await vi.waitFor(() => expect(grid.rowCount).toBe(2));

    await grid.search("zzz");
    await vi.waitFor(() => expect(grid.rowCount).toBe(0));

    await grid.clearQuery();
    await vi.waitFor(() => expect(grid.rowCount).toBe(5));
  });

  it("reads the query back", async () => {
    const { grid } = await seeded();
    await grid.sortBy("price", "desc");
    expect(grid.query.sort).toEqual([{ column: "price", direction: "desc" }]);
  });
});

describe("windows", () => {
  it("answers the exact window once it has arrived", async () => {
    const { grid } = await seeded();
    const stop = grid.watch(1, 2);
    await vi.waitFor(() => expect(ids(grid.view(1, 2))).toEqual([1, 2]));
    stop();
  });

  it("answers with the nearest rows it has rather than nothing", async () => {
    const { grid } = await seeded();
    grid.watch(0, 2);
    await vi.waitFor(() => expect(grid.view(0, 2).length).toBe(2));

    // A window nobody has asked for yet: the store still answers, with
    // the closest thing it holds and that view's own start.
    const near = grid.view(3, 2);
    expect(near.length).toBeGreaterThan(0);
    expect(near.start).toBe(0);

    await vi.waitFor(() => expect(grid.view(3, 2).start).toBe(3));
  });

  it("deduplicates and ref-counts registrations", async () => {
    const { client, grid } = await seeded();
    const spy = vi.spyOn(client, "setWindows");

    const a = grid.watch(0, 2);
    const b = grid.watch(0, 2);
    // The same window twice is one registration.
    expect(spy.mock.calls.at(-1)![1]).toHaveLength(1);

    a();
    // Still wanted by b, so it stays.
    expect(spy.mock.calls.at(-1)![1]).toHaveLength(1);

    b();
    expect(spy.mock.calls.at(-1)![1]).toHaveLength(0);
  });

  it("refreshes every registered window with one mutation", async () => {
    const { grid } = await seeded();
    grid.watch(0, 2);
    grid.watch(3, 2);
    await vi.waitFor(() => expect(grid.view(3, 2).length).toBe(2));

    await grid.setCell(3, "price", 77);
    // One round trip brought both windows back.
    expect(grid.view(0, 2).length).toBe(2);
    expect(grid.view(3, 2).get(0, "price")).toBe(77);
  });
});

describe("the dictionary mirror", () => {
  it("resolves strings the worker sent as deltas", async () => {
    const { grid } = await seeded();
    grid.watch(0, 5);
    await vi.waitFor(() => expect(grid.view(0, 5).length).toBe(5));
    expect(grid.view(0, 5).get(3, "status")).toBe("Shipped");

    await grid.setCell(0, "status", "refunded");
    await vi.waitFor(() => expect(grid.view(0, 5).get(0, "status")).toBe("refunded"));
  });
});

describe("disposal", () => {
  it("makes later calls throw and terminates the worker", async () => {
    const { client, grid } = await seeded();
    grid.dispose();

    expect(() => grid.rowCount).toThrowError(/disposed/);
    expect(() => grid.view(0, 1)).toThrowError(/disposed/);
    await expect(grid.setCell(0, "price", 1)).rejects.toThrowError(/disposed/);

    client.dispose();
    expect(workers.at(-1)!.terminated).toBe(true);
  });

  it("rejects calls in flight when the client goes", async () => {
    const { client, grid } = await seeded();
    const pending = grid.setCell(0, "price", 1);
    client.dispose();
    await expect(pending).rejects.toThrowError(/disposed/);
  });
});

describe("stale replies", () => {
  it("ignores an update describing a revision already passed", async () => {
    const { grid } = await seeded();
    grid.watch(0, 5);
    await vi.waitFor(() => expect(grid.view(0, 5).length).toBe(5));

    await grid.setCell(0, "price", 1);
    await grid.setCell(0, "price", 2);
    const current = grid.revision;

    // A read issued before those edits could still land now. The store
    // keeps the newer state rather than rewinding to what the reply saw.
    await vi.waitFor(() => expect(grid.revision).toBe(current));
    expect(grid.view(0, 5).get(0, "price")).toBe(2);
  });
});
