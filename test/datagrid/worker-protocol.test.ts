import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createGridHost } from "../../src/datagrid/worker-host";
import type { HostPort } from "../../src/core/worker/protocol";
import type {
  GridReply as Reply,
  Request,
  RequestBody,
  GridUpdate,
} from "../../src/datagrid/protocol";
import { ColumnType, type ColumnSpec } from "../../src/datagrid/abi";
import { ENGINE_URL, serveEngine } from "../helpers/engine";

/**
 * The worker's half of the protocol, driven through a fake port.
 *
 * Node has no Worker, and a real one would hide exactly the things worth
 * checking: that replies come back in order, that errors survive the
 * crossing with their code intact, and that a mutation's reply already
 * carries everything the store needs.
 */

const SCHEMA: ColumnSpec[] = [
  { name: "id", type: ColumnType.I32 },
  { name: "price", type: ColumnType.F64 },
  { name: "status", type: ColumnType.String },
];

beforeAll(() => serveEngine());
afterAll(() => vi.unstubAllGlobals());

/** A port that records what the host posts, and what it asked to transfer. */
function fakePort() {
  const replies: Reply[] = [];
  const transfers: Transferable[][] = [];
  const port: HostPort = {
    postMessage(reply, transfer) {
      replies.push(reply as Reply);
      transfers.push(transfer ?? []);
    },
  };
  return { port, replies, transfers, last: () => replies[replies.length - 1]! };
}

function driver() {
  const { port, replies, transfers, last } = fakePort();
  const host = createGridHost(port);
  let id = 0;

  const send = async (request: RequestBody) => {
    await host.handle({ ...request, id: id++ } as Request);
    return last();
  };

  return { send, replies, transfers, last };
}

const ok = (reply: Reply) => {
  if (!reply.ok) throw new Error(`expected ok, got ${reply.error.message}`);
  return reply;
};

async function opened() {
  const d = driver();
  ok(await d.send({ op: "open", url: ENGINE_URL, cache: true }));
  const created = ok(await d.send({ op: "createGrid", schema: SCHEMA }));
  return { ...d, handle: created.result as number };
}

async function seeded() {
  const d = await opened();
  ok(
    await d.send({
      op: "insertColumns",
      handle: d.handle,
      columns: [
        { kind: "i32", values: Int32Array.from([100, 200, 300, 400, 500]) },
        { kind: "f64", values: Float64Array.from([30, 10, 20, 10, 40]) },
        { kind: "string", values: ["paid", "new", "paid", "Shipped", "new"] },
      ],
      windows: [],
    })
  );
  return d;
}

describe("every operation", () => {
  it("opens, creates a grid and inserts", async () => {
    const d = await seeded();
    const reply = ok(await d.send({ op: "read", handle: d.handle, windows: [] }));
    expect(reply.update!.rowCount).toBe(5);
    expect(reply.update!.revision).toBe(1);
  });

  it("sets a cell of each kind", async () => {
    const d = await seeded();

    for (const [col, kind, value] of [
      [0, "i32", 99],
      [1, "f64", 9.75],
      [2, "string", "cancelled"],
    ] as const) {
      const reply = ok(
        await d.send({ op: "setCell", handle: d.handle, rowId: 0, col, kind, value, windows: [] })
      );
      expect(reply.update).toBeDefined();
    }

    const view = ok(
      await d.send({ op: "read", handle: d.handle, windows: [{ start: 0, count: 1 }] })
    ).update!.windows[0]!.view;
    expect(view.columns[0]![0]).toBe(99);
    expect(view.columns[1]![0]).toBe(9.75);
  });

  it("deletes rows", async () => {
    const d = await seeded();
    const reply = ok(
      await d.send({
        op: "deleteRows",
        handle: d.handle,
        rowIds: Int32Array.from([1, 3]),
        windows: [],
      })
    );
    expect(reply.update!.rowCount).toBe(3);
  });

  it("sets a query", async () => {
    const d = await seeded();
    const reply = ok(
      await d.send({
        op: "setQuery",
        handle: d.handle,
        query: { sort: [{ col: 1, desc: true }], filters: [], search: "" },
        windows: [{ start: 0, count: 5 }],
      })
    );
    expect([...reply.update!.windows[0]!.view.ids]).toEqual([4, 0, 2, 1, 3]);
  });

  it("drops a grid", async () => {
    const d = await seeded();
    ok(await d.send({ op: "dropGrid", handle: d.handle }));
    const reply = await d.send({ op: "read", handle: d.handle, windows: [] });
    expect(reply.ok).toBe(false);
  });
});

describe("the reply to a mutation", () => {
  it("carries the revision, the counts and every registered window", async () => {
    const d = await seeded();

    const reply = ok(
      await d.send({
        op: "setCell",
        handle: d.handle,
        rowId: 0,
        col: 1,
        kind: "f64",
        value: 1,
        windows: [
          { start: 0, count: 2 },
          { start: 3, count: 2 },
        ],
      })
    );

    const update = reply.update as GridUpdate;
    expect(update.revision).toBe(2);
    expect(update.rowCount).toBe(5);
    expect(update.totalRows).toBe(5);
    expect(update.windows).toHaveLength(2);
    expect(update.windows[0]!.view.start).toBe(0);
    expect(update.windows[1]!.view.start).toBe(3);
  });

  it("sends each dictionary entry once", async () => {
    const d = await opened();

    // The insert that created the entries is the reply that carries them.
    const insert = ok(
      await d.send({
        op: "insertColumns",
        handle: d.handle,
        columns: [
          { kind: "i32", values: Int32Array.from([100, 200, 300]) },
          { kind: "f64", values: Float64Array.from([30, 10, 20]) },
          { kind: "string", values: ["paid", "new", "paid"] },
        ],
        windows: [],
      })
    );
    expect(insert.update!.dictionaries[2]).toEqual(["paid", "new"]);

    // Nothing was added since, so nothing is sent again.
    const second = ok(await d.send({ op: "read", handle: d.handle, windows: [] }));
    expect(second.update!.dictionaries[2]).toBeUndefined();

    // A new value is sent on its own, not with the ones already known.
    const third = ok(
      await d.send({
        op: "setCell",
        handle: d.handle,
        rowId: 0,
        col: 2,
        kind: "string",
        value: "refunded",
        windows: [],
      })
    );
    expect(third.update!.dictionaries[2]).toEqual(["refunded"]);
  });

  it("transfers the row buffers rather than copying them", async () => {
    const d = await seeded();
    const before = d.transfers.length;

    ok(
      await d.send({
        op: "read",
        handle: d.handle,
        windows: [{ start: 0, count: 5 }],
      })
    );

    // One buffer for the ids, one per column.
    const transfer = d.transfers[before]!;
    expect(transfer).toHaveLength(1 + SCHEMA.length);
    for (const item of transfer) expect(item).toBeInstanceOf(ArrayBuffer);
  });

  it("transfers nothing when no window was asked for", async () => {
    const d = await seeded();
    const before = d.transfers.length;
    ok(await d.send({ op: "read", handle: d.handle, windows: [] }));
    expect(d.transfers[before]).toHaveLength(0);
  });
});

describe("ordering", () => {
  it("replies in the order the requests arrived", async () => {
    const d = await seeded();

    // Issued without awaiting each one, the way the client sends them.
    const host = d;
    await Promise.all([
      host.send({ op: "read", handle: host.handle, windows: [] }),
      host.send({ op: "read", handle: host.handle, windows: [] }),
      host.send({ op: "read", handle: host.handle, windows: [] }),
    ]);

    const ids = d.replies.map((reply) => reply.id);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
  });
});

describe("errors", () => {
  it("come back with their code, status and op", async () => {
    const d = await seeded();

    const reply = await d.send({
      op: "setCell",
      handle: d.handle,
      rowId: 999,
      col: 0,
      kind: "i32",
      value: 1,
      windows: [],
    });

    expect(reply.ok).toBe(false);
    if (reply.ok) return;
    expect(reply.error.code).toBe("out-of-range");
    expect(reply.error.status).toBe(-2);
    expect(reply.error.op).toBe("setCell");
    expect(reply.error.message).toMatch(/out of range/);
  });

  it("report a bad handle", async () => {
    const d = await opened();
    const reply = await d.send({ op: "read", handle: 99, windows: [] });
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.code).toBe("bad-handle");
  });

  it("report a call made before the engine opened", async () => {
    const d = driver();
    const reply = await d.send({ op: "createGrid", schema: SCHEMA });
    expect(reply.ok).toBe(false);
    if (!reply.ok) expect(reply.error.code).toBe("disposed");
  });

  it("report a bad query without losing the previous one", async () => {
    const d = await seeded();
    ok(
      await d.send({
        op: "setQuery",
        handle: d.handle,
        query: { sort: [{ col: 1, desc: true }], filters: [], search: "" },
        windows: [],
      })
    );

    const reply = await d.send({
      op: "setQuery",
      handle: d.handle,
      query: { sort: [{ col: 9, desc: false }], filters: [], search: "" },
      windows: [],
    });
    expect(reply.ok).toBe(false);

    const after = ok(
      await d.send({ op: "read", handle: d.handle, windows: [{ start: 0, count: 5 }] })
    );
    expect([...after.update!.windows[0]!.view.ids]).toEqual([4, 0, 2, 1, 3]);
  });
});

describe("windows", () => {
  it("clamps a window past the end and says where it really starts", async () => {
    const d = await seeded();
    const reply = ok(
      await d.send({ op: "read", handle: d.handle, windows: [{ start: 99, count: 10 }] })
    );
    const window = reply.update!.windows[0]!;
    expect(window.start).toBe(99);
    expect(window.view.start).toBe(5);
    expect(window.view.ids).toHaveLength(0);
  });

  it("answers several windows in the order they were asked for", async () => {
    const d = await seeded();
    const reply = ok(
      await d.send({
        op: "read",
        handle: d.handle,
        windows: [
          { start: 3, count: 2 },
          { start: 0, count: 2 },
        ],
      })
    );
    expect(reply.update!.windows.map((w) => w.start)).toEqual([3, 0]);
  });
});
