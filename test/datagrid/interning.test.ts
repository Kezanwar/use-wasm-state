import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateOrders, orders } from "../../examples/react-demo/src/lib/orders";
import { encodeStrings, Status } from "../../src/datagrid/abi";
import { bytesIn, u32In, withInput } from "../../src/core/wasm/input";
import { loadSyncEngine } from "../../src/datagrid/engine";
import { defineSchema } from "../../src/datagrid/index";
import {
  createGrid,
  ENGINE_URL,
  insertColumns,
  newEngine,
  readDictSince,
  readView,
  serveEngine,
} from "../helpers/engine";

/**
 * Strings are interned in JS before they cross, and only the ones a
 * dictionary lacks are sent. The engine checks those against what it holds
 * rather than trusting the ids, so the grid it ends up with must be exactly
 * the one it would have built interning every row itself.
 */

beforeAll(() => serveEngine());
afterAll(() => vi.unstubAllGlobals());

const ROWS = 200_000;
const data = generateOrders(ROWS);

/** Every string column of a grid: its dictionary and its ids, in row order. */
function snapshot(e: Awaited<ReturnType<typeof newEngine>>, h: number) {
  const view = readView(e, h, 0, ROWS, orders.columns)!;
  return orders.kinds.flatMap((kind, col) =>
    kind === "string" ? [{ dict: readDictSince(e, h, col, 0), ids: [...view.columns[col]!] }] : []
  );
}

describe("interning in JS", () => {
  it("builds the grid the engine builds interning every row itself", async () => {
    const mine = await newEngine();
    const mh = createGrid(mine, orders.columns);
    expect(
      insertColumns(
        mine,
        mh,
        orders.names.map((name, col) =>
          orders.kinds[col] === "string"
            ? { type: 2 as const, values: data[name] as string[] }
            : {
                type: orders.kinds[col] === "f64" ? (1 as const) : (0 as const),
                values: data[name] as ArrayLike<number>,
              }
        )
      )
    ).toBe(0);

    // The reference: every row's string sent as new, so the engine interns
    // all 200k and folds the repeats, which is what it used to do alone.
    const ref = await newEngine();
    const rh = createGrid(ref, orders.columns);
    const status = withInput(ref, [u32In(new Uint32Array(orders.names.length))], ([out]) => {
      expect(ref.reserveRows(rh, ROWS, out.ptr, orders.names.length)).toBe(Status.OK);
      const at = new Uint32Array(ref.memory.buffer, out.ptr, orders.names.length);
      orders.names.forEach((name, col) => {
        const kind = orders.kinds[col];
        if (kind === "f64") new Float64Array(ref.memory.buffer, at[col], ROWS).set(data.price);
        else if (kind === "i32")
          new Int32Array(ref.memory.buffer, at[col], ROWS).set(data[name] as Int32Array);
        else
          new Int32Array(ref.memory.buffer, at[col], ROWS).set(
            Int32Array.from({ length: ROWS }, (_, j) => j)
          );
      });
      return Status.OK;
    });
    expect(status).toBe(Status.OK);
    const strings = orders.names.map((name, col) =>
      orders.kinds[col] === "string" ? encodeStrings(data[name] as string[]) : null
    );
    const args = strings.flatMap((s) => (s ? [bytesIn(s.blob), u32In(s.offsets)] : []));
    args.push(u32In(new Uint32Array(orders.names.length * 4)));
    const first = withInput(ref, args, (blocks) => {
      const descs = new Uint32Array(ref.memory.buffer, blocks.at(-1)!.ptr, orders.names.length * 4);
      let b = 0;
      strings.forEach((s, col) => {
        if (!s) return;
        descs.set([blocks[b]!.ptr, blocks[b]!.len, blocks[b + 1]!.ptr, ROWS], col * 4);
        b += 2;
      });
      return ref.commitRows(rh, ROWS, blocks.at(-1)!.ptr, orders.names.length);
    });
    expect(first).toBe(0);

    const a = snapshot(mine, mh);
    const b = snapshot(ref, rh);
    for (let i = 0; i < a.length; i++) {
      expect(a[i]!.dict).toEqual(b[i]!.dict);
      expect(a[i]!.ids).toEqual(b[i]!.ids);
      // And no value twice.
      expect(new Set(a[i]!.dict).size).toBe(a[i]!.dict!.length);
    }
  });
});

describe("through the store", () => {
  const schema = defineSchema({ n: "i32", s: "string" });

  async function grid() {
    const engine = await loadSyncEngine({ wasmUrl: ENGINE_URL });
    return engine.createGrid(schema);
  }
  const strings = (g: Awaited<ReturnType<typeof grid>>) =>
    g
      .view(0, g.totalRows)
      .rows()
      .map((row) => row.s);

  it("reuses the strings a column holds and adds only the new ones", async () => {
    const g = await grid();
    g.insertColumns({ n: [1, 2, 3], s: ["a", "b", "a"] });
    g.setCell(0, "s", "edited");
    g.insertColumns({ n: [4, 5, 6, 7], s: ["b", "c", "edited", "c"] });
    g.insertRows([{ n: 8, s: "a" }]);

    expect(strings(g)).toEqual(["edited", "b", "a", "b", "c", "edited", "c", "a"]);
  });

  it("round-trips non-ASCII text and does not grow on a repeat", async () => {
    const g = await grid();
    const text = ["café", "日本語", "straße", "😀 ok", "", "ünïcødé"];
    g.insertColumns({ n: text.map((_, i) => i), s: text });
    g.insertColumns({ n: text.map((_, i) => i), s: [...text].reverse() });
    expect(strings(g)).toEqual([...text, ...[...text].reverse()]);
  });

  it("folds lone surrogates into the one string of bytes they encode to", async () => {
    const g = await grid();
    // Three different JS strings, one UTF-8 string: U+FFFD.
    g.insertColumns({ n: [1, 2, 3, 4], s: ["\uD800", "\uDC00", "�", "x"] });
    g.insertRows([
      { n: 5, s: "\uD800" },
      { n: 6, s: "y" },
    ]);
    g.setCell(3, "s", "\uDBFF");

    expect(strings(g)).toEqual(["�", "�", "�", "�", "�", "y"]);
    // And the strings after a fold still land on the right rows.
    g.insertRows([
      { n: 7, s: "z" },
      { n: 8, s: "\uDC00" },
      { n: 9, s: "x" },
    ]);
    expect(strings(g).slice(-3)).toEqual(["z", "�", "x"]);
  });
});
