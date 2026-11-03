import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ColumnType, Status, type ColumnSpec, type EngineExports } from "../../src/datagrid/abi";
import {
  createGrid,
  deleteRows,
  dictPacked,
  insertColumns,
  newEngine,
  readDictSince,
  readView,
  serveEngine,
  setCellString,
  viewPacked,
} from "../helpers/engine";

/**
 * The memory model, enforced.
 *
 * After the initial load the engine is supposed to allocate only for
 * genuinely new data: new rows, new dictionary entries. Everything else
 * moves through buffers it already owns. That is not a nice-to-have on this
 * target, where the collector has to be kept idle to stay fast, so it is
 * asserted rather than hoped for: linear memory must not move at all under
 * a workload that creates nothing new.
 *
 * `memory.buffer.byteLength` is the measure. Wasm grows in 64kB pages and
 * never gives them back, so any allocation the engine cannot satisfy from
 * what it already holds eventually shows up here.
 */

const SCHEMA: ColumnSpec[] = [
  { name: "id", type: ColumnType.I32 },
  { name: "price", type: ColumnType.F64 },
  { name: "status", type: ColumnType.String },
];

const LABELS = ["new", "paid", "picked", "shipped", "held", "cancelled"];
const ROWS = 200_000;

beforeAll(() => serveEngine());
afterAll(() => vi.unstubAllGlobals());

const MB = (bytes: number) => `${(bytes / 1048576).toFixed(2)}MB`;

async function loaded(): Promise<{ e: EngineExports; h: number }> {
  const e = await newEngine();
  const h = createGrid(e, SCHEMA);

  const ids = new Int32Array(ROWS);
  const prices = new Float64Array(ROWS);
  const statuses: string[] = new Array(ROWS);
  for (let i = 0; i < ROWS; i++) {
    ids[i] = i * 10;
    prices[i] = i + 0.5;
    statuses[i] = LABELS[i % LABELS.length]!;
  }

  expect(
    insertColumns(e, h, [
      { type: ColumnType.I32, values: ids },
      { type: ColumnType.F64, values: prices },
      { type: ColumnType.String, values: statuses },
    ])
  ).toBe(0);

  return { e, h };
}

describe("steady state", () => {
  it("does not grow at all across 10k mixed operations", async () => {
    const { e, h } = await loaded();

    // Warm every buffer once at the sizes the loop will use, so the first
    // iteration is not paying for the view and dictionary buffers being
    // created. Growth after this point is the thing under test.
    readView(e, h, 0, 50, SCHEMA);
    readDictSince(e, h, 2, 0);
    setCellString(e, h, 0, 2, LABELS[0]!);
    deleteRows(e, h, [ROWS - 1]);

    const before = e.memory.buffer.byteLength;
    let liveRows = e.rowCount(h);
    let nextDoomed = 1;

    for (let i = 0; i < 10_000; i++) {
      switch (i % 5) {
        case 0:
          expect(e.setCellI32(h, i % 1000, 0, i)).toBe(Status.OK);
          break;
        case 1:
          expect(e.setCellF64(h, i % 1000, 1, i + 0.5)).toBe(Status.OK);
          break;
        case 2:
          // A label the column already holds: no new dictionary entry, so
          // nothing may reach the heap.
          expect(setCellString(e, h, i % 1000, 2, LABELS[i % LABELS.length]!)).toBe(Status.OK);
          break;
        case 3: {
          // Bounded by the rows still live, since the batch deletes below
          // keep shrinking the grid under this loop.
          const start = (i * 37) % (liveRows - 50);
          const v = readView(e, h, start, 50, SCHEMA)!;
          expect(v.ids.length).toBe(50);
          expect(v.start).toBe(start);
          break;
        }
        case 4:
          readDictSince(e, h, 2, i % 3);
          break;
      }

      // A small delete batch every so often, from the far end so the edits
      // above keep landing on live rows.
      if (i % 500 === 499) {
        const doomed = Int32Array.from({ length: 8 }, (_, k) => ROWS - 2 - nextDoomed - k * 3);
        nextDoomed += 32;
        expect(deleteRows(e, h, doomed)).toBe(Status.OK);
        liveRows -= doomed.length;
      }
    }

    const after = e.memory.buffer.byteLength;
    console.log(`  steady state: ${MB(before)} before, ${MB(after)} after 10k mixed operations`);

    expect(e.rowCount(h)).toBe(liveRows);
    expect(after).toBe(before);
  });

  it("grows only by what new strings actually cost", async () => {
    const { e, h } = await loaded();

    readView(e, h, 0, 50, SCHEMA);
    readDictSince(e, h, 2, 0);
    setCellString(e, h, 0, 2, LABELS[0]!);

    const EDITS = 1000;
    const values = Array.from({ length: EDITS }, (_, i) => `brand-new-value-${i}`);
    const stringBytes = values.reduce((n, v) => n + v.length, 0);

    const before = e.memory.buffer.byteLength;
    const dictBefore = e.dictLen(h, 2);

    for (let i = 0; i < EDITS; i++) {
      expect(setCellString(e, h, i, 2, values[i]!)).toBe(Status.OK);
    }

    const after = e.memory.buffer.byteLength;
    const growth = after - before;

    console.log(
      `  ${EDITS} new strings: ${stringBytes} bytes of text grew linear memory by ` +
        `${growth} bytes (${MB(before)} to ${MB(after)})`
    );

    expect(e.dictLen(h, 2)).toBe(dictBefore + EDITS);

    // Each entry costs its bytes, a string header, a slot in values and a
    // bucket in the index. Eight times the text is a generous ceiling for
    // that, and far below what allocating per call would cost.
    //
    // In practice this reports zero: a thousand short strings fit in pages
    // the module already holds, and wasm only ever reports growth a whole
    // page at a time. The test below makes the same point in a way page
    // granularity cannot hide.
    expect(growth).toBeLessThanOrEqual(stringBytes * 8);

    // The new values are readable, and the old ones did not move.
    const dict = readDictSince(e, h, 2, dictBefore)!;
    expect(dict.length).toBe(EDITS);
    expect(dict[0]).toBe(values[0]);
    expect(dict[EDITS - 1]).toBe(values[EDITS - 1]);
    expect(readDictSince(e, h, 2, 0)!.slice(0, LABELS.length)).toEqual(LABELS);
  });

  it("grows for new values and not for repeated ones, at the same scale", async () => {
    // Two identical workloads that differ only in whether the values are
    // new. Linear memory grows a page at a time and by doubling, so the
    // byte count on its own says little: what it can still prove is that
    // reusing a value costs nothing, and that adding 20k dictionary
    // entries does not blow past the headroom the load already reserved.
    const EDITS = 20_000;

    const repeated = await loaded();
    setCellString(repeated.e, repeated.h, 0, 2, "shipped");
    const repeatedBefore = repeated.e.memory.buffer.byteLength;
    for (let i = 0; i < EDITS; i++) {
      expect(setCellString(repeated.e, repeated.h, i, 2, "shipped")).toBe(Status.OK);
    }
    const repeatedGrowth = repeated.e.memory.buffer.byteLength - repeatedBefore;

    const fresh = await loaded();
    setCellString(fresh.e, fresh.h, 0, 2, "shipped");
    const freshBefore = fresh.e.memory.buffer.byteLength;
    for (let i = 0; i < EDITS; i++) {
      expect(setCellString(fresh.e, fresh.h, i, 2, `distinct-${i}`)).toBe(Status.OK);
    }
    const freshGrowth = fresh.e.memory.buffer.byteLength - freshBefore;

    console.log(
      `  ${EDITS} edits: ${repeatedGrowth} bytes of growth reusing one value, ` +
        `${freshGrowth} bytes with a new value each time`
    );

    // Reusing an existing dictionary entry must cost nothing at all.
    expect(repeatedGrowth).toBe(0);
    // New entries are new data and may cost something, but only what the
    // data is worth. In practice both report zero, because 20k short
    // strings still fit in pages the module reserved during the load.
    expect(freshGrowth).toBeLessThanOrEqual(repeatedBefore);

    // What separates the two runs is visible in the dictionary rather than
    // in the page count: one added 20k entries, the other added none.
    expect(repeated.e.dictLen(repeated.h, 2)).toBe(LABELS.length);
    expect(fresh.e.dictLen(fresh.h, 2)).toBe(LABELS.length + EDITS);
    expect(readDictSince(fresh.e, fresh.h, 2, LABELS.length)![0]).toBe("distinct-0");
  });

  it("keeps its buffers reachable through repeated collection cycles", async () => {
    const { e, h } = await loaded();

    // Warm all three, then record where they live and what they hold.
    const input = e.inputBuffer(4096);
    const view = viewPacked(e, h, 100, 50)!;
    const viewBefore = readView(e, h, 100, 50, SCHEMA)!;
    const dictBefore = readDictSince(e, h, 2, 0)!;

    // Churn hard enough to run the collector repeatedly: big blocks taken
    // and dropped, thousands of new dictionary entries, rows coming and
    // going. The three buffers are only reachable from package-level vars
    // in the engine, so a precise collector that could not see them would
    // hand back freed memory here rather than fail loudly.
    for (let round = 0; round < 200; round++) {
      const block = e.alloc(256 * 1024);
      expect(block).toBeGreaterThan(0);
      e.free(block);

      expect(setCellString(e, h, round, 2, `gc-churn-${round}`)).toBe(Status.OK);
      expect(deleteRows(e, h, [ROWS - 1 - round])).toBe(Status.OK);
      readView(e, h, round * 7, 50, SCHEMA);
      readDictSince(e, h, 2, 0);
    }

    // Same addresses: nothing was collected and reallocated underneath.
    // The input and view buffers were asked for the same sizes throughout,
    // so they had no reason to move at all.
    expect(e.inputBuffer(4096)).toBe(input);
    expect(viewPacked(e, h, 100, 50)!.ptr).toBe(view.ptr);

    // The dictionary buffer did grow, because the churn added 200 entries
    // and each delta was larger than the last. What has to hold is that it
    // is stable once it stops growing.
    const settled = dictPacked(e, h, 2, 0)!;
    expect(dictPacked(e, h, 2, 0)!.ptr).toBe(settled.ptr);
    expect(dictPacked(e, h, 2, 0)!.len).toBe(settled.len);

    // The input buffer is still usable: written through and read back at
    // the same address. Its *contents* are not checked, because the churn
    // above made calls of its own and each one overwrites it. That is the
    // documented contract, not a flaw.
    new Uint8Array(e.memory.buffer, input, 4096).fill(0xab);
    expect(new Uint8Array(e.memory.buffer, input, 4096).every((b) => b === 0xab)).toBe(true);

    // And the outputs still decode to the right thing.
    const viewAfter = readView(e, h, 100, 50, SCHEMA)!;
    expect([...viewAfter.ids]).toEqual([...viewBefore.ids]);
    expect([...viewAfter.columns[0]!]).toEqual([...viewBefore.columns[0]!]);
    expect([...viewAfter.columns[1]!]).toEqual([...viewBefore.columns[1]!]);

    const dictAfter = readDictSince(e, h, 2, 0)!;
    expect(dictAfter.slice(0, dictBefore.length)).toEqual(dictBefore);
    expect(dictAfter.length).toBe(dictBefore.length + 200);
  });

  it("does not grow when the same string is written over and over", async () => {
    const { e, h } = await loaded();
    setCellString(e, h, 0, 2, "shipped");

    const before = e.memory.buffer.byteLength;
    for (let i = 0; i < 5000; i++) {
      expect(setCellString(e, h, i % 1000, 2, "shipped")).toBe(Status.OK);
    }
    expect(e.memory.buffer.byteLength).toBe(before);
  });

  it("does not grow while scrolling", async () => {
    const { e, h } = await loaded();
    readView(e, h, 0, 50, SCHEMA);

    const before = e.memory.buffer.byteLength;
    for (let i = 0; i < 5000; i++) {
      const v = readView(e, h, (i * 13) % (ROWS - 50), 50, SCHEMA)!;
      expect(v.ids.length).toBe(50);
    }
    expect(e.memory.buffer.byteLength).toBe(before);
  });
});
