import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  ColumnType,
  ENGINE_EXPORTS,
  Status,
  encodeSchema,
  viewOffsets,
  type ColumnSpec,
  type EngineExports,
} from "../src/engine/abi";
import {
  createTable,
  deleteRows,
  dictPacked,
  insertColumns,
  newEngine,
  readDictSince,
  readView,
  serveEngine,
  setCellString,
  viewPacked,
} from "./helpers/engine";
import { bytesIn, f64In, i32In, stringIn, u32In, withInput } from "../src/engine/input";

/**
 * The ABI, exercised against the committed src/wasm/engine.wasm through the
 * copied loader. This is the only place the Go and the TypeScript halves of
 * the wire format meet, so a disagreement between them shows up here and
 * nowhere else.
 */

const SCHEMA: ColumnSpec[] = [
  { name: "id", type: ColumnType.I32 },
  { name: "price", type: ColumnType.F64 },
  { name: "status", type: ColumnType.String },
];

const LABELS = ["new", "paid", "picked", "shipped", "held", "cancelled"];

beforeAll(() => serveEngine());
afterAll(() => vi.unstubAllGlobals());

async function seeded(rows: number): Promise<{ e: EngineExports; h: number }> {
  const e = await newEngine();
  const h = createTable(e, SCHEMA);

  const ids = new Int32Array(rows);
  const prices = new Float64Array(rows);
  const statuses: string[] = new Array(rows);
  for (let i = 0; i < rows; i++) {
    ids[i] = i * 10;
    prices[i] = i + 0.5;
    statuses[i] = LABELS[i % LABELS.length]!;
  }

  const first = insertColumns(e, h, [
    { type: ColumnType.I32, values: ids },
    { type: ColumnType.F64, values: prices },
    { type: ColumnType.String, values: statuses },
  ]);
  expect(first).toBe(0);
  return { e, h };
}

/* ------------------------------------------------------------------ */
/* Memory                                                              */
/* ------------------------------------------------------------------ */

describe("alloc / free", () => {
  it("returns 8-byte aligned offsets so Float64Array can be mapped on them", async () => {
    const e = await newEngine();
    for (const size of [1, 3, 8, 9, 64, 1000]) {
      const ptr = e.alloc(size);
      expect(ptr, `alloc(${size})`).toBeGreaterThan(0);
      expect(ptr % 8, `alloc(${size}) alignment`).toBe(0);
      // The thing the alignment exists for.
      expect(() => new Float64Array(e.memory.buffer, ptr, 1)).not.toThrow();
      e.free(ptr);
    }
  });

  it("returns 0 for a non-positive size", async () => {
    const e = await newEngine();
    expect(e.alloc(0)).toBe(0);
    expect(e.alloc(-1)).toBe(0);
  });

  it("survives a double free and a pointer it never issued", async () => {
    const e = await newEngine();
    const ptr = e.alloc(16);
    e.free(ptr);
    // Leaking beats trapping: a JS bug should not take the page down.
    expect(() => e.free(ptr)).not.toThrow();
    expect(() => e.free(0)).not.toThrow();
  });

  it("round-trips bytes written through the input buffer", async () => {
    const e = await newEngine();
    const data = new Uint8Array([1, 2, 3, 250, 255]);
    const seen = withInput(e, [bytesIn(data)], ([block]) => [
      ...new Uint8Array(e.memory.buffer, block.ptr, block.len),
    ]);
    expect(seen).toEqual([...data]);
  });
});

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

describe("createTable / dropTable", () => {
  it("accepts a schema encoded by the TS side", async () => {
    const e = await newEngine();
    expect(createTable(e, SCHEMA)).toBe(0);
    expect(createTable(e, SCHEMA)).toBe(1);
  });

  it("accepts multi-byte column names", async () => {
    const e = await newEngine();
    const h = createTable(e, [
      { name: "prix en €", type: ColumnType.F64 },
      { name: "名前", type: ColumnType.String },
    ]);
    expect(h).toBeGreaterThanOrEqual(0);
    expect(e.rowCount(h)).toBe(0);
  });

  it("rejects a malformed schema", async () => {
    const e = await newEngine();

    const cases: Array<[string, Uint8Array]> = [
      ["empty schema", encodeSchema([])],
      ["truncated", encodeSchema(SCHEMA).slice(0, 6)],
      [
        "unknown type byte",
        (() => {
          const b = encodeSchema(SCHEMA);
          b[4] = 9;
          return b;
        })(),
      ],
      [
        "duplicate column name",
        encodeSchema([
          { name: "a", type: ColumnType.I32 },
          { name: "a", type: ColumnType.F64 },
        ]),
      ],
    ];

    for (const [name, bytes] of cases) {
      const status = withInput(e, [bytesIn(bytes)], ([b]) => e.createTable(b.ptr, b.len));
      expect(status, name).toBe(Status.BadSchema);
    }
  });

  it("rejects a null or zero-length schema pointer", async () => {
    const e = await newEngine();
    expect(e.createTable(0, 0)).toBe(Status.BadSchema);
  });

  it("drops a table and never reuses its handle", async () => {
    const e = await newEngine();
    const dropped = createTable(e, SCHEMA);

    expect(e.dropTable(dropped)).toBe(Status.OK);
    expect(e.dropTable(dropped)).toBe(Status.BadHandle);
    expect(createTable(e, SCHEMA)).not.toBe(dropped);
  });
});

/* ------------------------------------------------------------------ */
/* Insert                                                              */
/* ------------------------------------------------------------------ */

describe("insertColumns", () => {
  it("appends rows and returns the first row id", async () => {
    const e = await newEngine();
    const h = createTable(e, SCHEMA);

    expect(
      insertColumns(e, h, [
        { type: ColumnType.I32, values: [1, 2] },
        { type: ColumnType.F64, values: [1.5, 2.5] },
        { type: ColumnType.String, values: ["a", "b"] },
      ])
    ).toBe(0);

    expect(
      insertColumns(e, h, [
        { type: ColumnType.I32, values: [3] },
        { type: ColumnType.F64, values: [3.5] },
        { type: ColumnType.String, values: ["c"] },
      ])
    ).toBe(2);

    expect(e.rowCount(h)).toBe(3);
    expect(e.totalRows(h)).toBe(3);
  });

  it("accepts an insert of no rows", async () => {
    const e = await newEngine();
    const h = createTable(e, SCHEMA);
    expect(
      insertColumns(e, h, [
        { type: ColumnType.I32, values: [] },
        { type: ColumnType.F64, values: [] },
        { type: ColumnType.String, values: [] },
      ])
    ).toBe(0);
    expect(e.rowCount(h)).toBe(0);
  });

  it("round-trips multi-byte strings", async () => {
    const e = await newEngine();
    const h = createTable(e, SCHEMA);
    const values = ["café", "日本語", "", "straße"];

    insertColumns(e, h, [
      { type: ColumnType.I32, values: [1, 2, 3, 4] },
      { type: ColumnType.F64, values: [1, 2, 3, 4] },
      { type: ColumnType.String, values },
    ]);

    expect(readDictSince(e, h, 2, 0)).toEqual(values);
  });

  it("rejects ragged columns with RowCount", async () => {
    const e = await newEngine();
    const h = createTable(e, SCHEMA);

    expect(
      insertColumns(e, h, [
        { type: ColumnType.I32, values: [1, 2] },
        { type: ColumnType.F64, values: [1] },
        { type: ColumnType.String, values: ["a", "b"] },
      ])
    ).toBe(Status.RowCount);
    expect(e.rowCount(h)).toBe(0);
  });

  it("rejects the wrong number of descriptors with BadArgument", async () => {
    const e = await newEngine();
    const h = createTable(e, SCHEMA);

    expect(
      insertColumns(e, h, [
        { type: ColumnType.I32, values: [1] },
        { type: ColumnType.F64, values: [1] },
      ])
    ).toBe(Status.BadArgument);
  });

  it("rejects a misaligned data pointer with BadArgument", async () => {
    const e = await newEngine();
    const h = createTable(e, SCHEMA);

    // Descriptors pointing one byte off an aligned offset. Reinterpreting
    // that as float64s would be undefined behaviour, so it has to be
    // refused rather than read.
    const status = withInput(
      e,
      [bytesIn(new Uint8Array(64)), u32In(new Uint32Array(SCHEMA.length * 4))],
      ([data, descPtr]) => {
        const descs = new Uint32Array(e.memory.buffer, descPtr.ptr, SCHEMA.length * 4);
        descs.set([data.ptr + 1, 1, 0, 1], 0);
        descs.set([data.ptr + 1, 1, 0, 1], 4);
        descs.set([data.ptr + 1, 1, data.ptr, 1], 8);
        return e.insertColumns(h, descPtr.ptr, SCHEMA.length);
      }
    );
    expect(status).toBe(Status.BadArgument);
  });

  it("rejects string offsets that run past the blob", async () => {
    const e = await newEngine();
    const h = createTable(e, [{ name: "s", type: ColumnType.String }]);

    const status = withInput(
      e,
      [
        bytesIn(new TextEncoder().encode("ab")),
        u32In(Uint32Array.from([0, 999])),
        u32In(new Uint32Array(4)),
      ],
      ([blob, offsets, descPtr]) => {
        new Uint32Array(e.memory.buffer, descPtr.ptr, 4).set([blob.ptr, blob.len, offsets.ptr, 1]);
        return e.insertColumns(h, descPtr.ptr, 1);
      }
    );
    // Offsets that leave the blob are caught before a byte of it is read.
    expect(status).toBe(Status.RowCount);
  });
});

/* ------------------------------------------------------------------ */
/* Edits                                                               */
/* ------------------------------------------------------------------ */

describe("setCell and deleteRows", () => {
  it("writes each column type", async () => {
    const { e, h } = await seeded(4);

    expect(e.setCellI32(h, 1, 0, 99)).toBe(Status.OK);
    expect(e.setCellF64(h, 1, 1, 9.75)).toBe(Status.OK);
    expect(setCellString(e, h, 1, 2, "cancelled")).toBe(Status.OK);

    const v = readView(e, h, 1, 1, SCHEMA)!;
    expect(v.columns[0]![0]).toBe(99);
    expect(v.columns[1]![0]).toBe(9.75);

    const dict = readDictSince(e, h, 2, 0)!;
    expect(dict[v.columns[2]![0]!]).toBe("cancelled");
  });

  it("reports OutOfRange for a bad row or column", async () => {
    const { e, h } = await seeded(4);

    expect(e.setCellI32(h, 999, 0, 1)).toBe(Status.OutOfRange);
    expect(e.setCellI32(h, -1, 0, 1)).toBe(Status.OutOfRange);
    expect(e.setCellI32(h, 0, 99, 1)).toBe(Status.OutOfRange);
    expect(e.setCellF64(h, 0, -1, 1)).toBe(Status.OutOfRange);
    expect(setCellString(e, h, 0, 99, "x")).toBe(Status.OutOfRange);
  });

  it("reports WrongType when the column holds something else", async () => {
    const { e, h } = await seeded(4);

    expect(e.setCellI32(h, 0, 1, 1)).toBe(Status.WrongType);
    expect(e.setCellF64(h, 0, 2, 1)).toBe(Status.WrongType);
    expect(setCellString(e, h, 0, 0, "x")).toBe(Status.WrongType);
  });

  it("reports RowDeleted once the row is tombstoned", async () => {
    const { e, h } = await seeded(4);
    expect(deleteRows(e, h, [1])).toBe(Status.OK);

    expect(e.setCellI32(h, 1, 0, 1)).toBe(Status.RowDeleted);
    expect(e.setCellF64(h, 1, 1, 1)).toBe(Status.RowDeleted);
    expect(setCellString(e, h, 1, 2, "x")).toBe(Status.RowDeleted);
    expect(deleteRows(e, h, [1])).toBe(Status.RowDeleted);
  });

  it("reports BadArgument for a negative string length or row count", async () => {
    const { e, h } = await seeded(4);

    expect(e.setCellString(h, 0, 2, 0, -1)).toBe(Status.BadArgument);
    expect(e.deleteRows(h, 0, -1)).toBe(Status.BadArgument);
  });

  it("deletes without moving the surviving row ids", async () => {
    const { e, h } = await seeded(5);
    expect(deleteRows(e, h, [0, 2])).toBe(Status.OK);

    expect(e.rowCount(h)).toBe(3);
    // Tombstones stay, because ids are positions.
    expect(e.totalRows(h)).toBe(5);

    const v = readView(e, h, 0, 10, SCHEMA)!;
    expect([...v.ids]).toEqual([1, 3, 4]);
    expect([...v.columns[0]!]).toEqual([10, 30, 40]);
  });

  it("accepts a delete of nothing", async () => {
    const { e, h } = await seeded(4);
    expect(e.deleteRows(h, 0, 0)).toBe(Status.OK);
    expect(e.rowCount(h)).toBe(4);
  });
});

/* ------------------------------------------------------------------ */
/* Revision                                                            */
/* ------------------------------------------------------------------ */

describe("revision", () => {
  it("moves only on a successful, non-empty mutation", async () => {
    const e = await newEngine();
    const h = createTable(e, SCHEMA);

    const rev = () => e.revision(h) >>> 0;
    expect(rev()).toBe(0);

    insertColumns(e, h, [
      { type: ColumnType.I32, values: [1, 2] },
      { type: ColumnType.F64, values: [1, 2] },
      { type: ColumnType.String, values: ["a", "b"] },
    ]);
    expect(rev()).toBe(1);

    // Nothing changed: waking every subscriber here is a wasted render.
    insertColumns(e, h, [
      { type: ColumnType.I32, values: [] },
      { type: ColumnType.F64, values: [] },
      { type: ColumnType.String, values: [] },
    ]);
    expect(rev()).toBe(1);

    expect(e.setCellI32(h, 0, 0, 7)).toBe(Status.OK);
    expect(rev()).toBe(2);

    expect(e.setCellI32(h, 999, 0, 7)).toBe(Status.OutOfRange);
    expect(rev()).toBe(2);

    expect(e.deleteRows(h, 0, 0)).toBe(Status.OK);
    expect(rev()).toBe(2);

    expect(deleteRows(e, h, [1])).toBe(Status.OK);
    expect(rev()).toBe(3);

    expect(deleteRows(e, h, [1])).toBe(Status.RowDeleted);
    expect(rev()).toBe(3);
  });
});

/* ------------------------------------------------------------------ */
/* View                                                                */
/* ------------------------------------------------------------------ */

describe("view", () => {
  it("reads windows at the start, the middle and the end", async () => {
    const { e, h } = await seeded(1000);

    for (const start of [0, 500, 950]) {
      const v = readView(e, h, start, 50, SCHEMA)!;
      expect(v.ids.length, `start ${start}`).toBe(50);
      for (let i = 0; i < 50; i++) {
        const row = start + i;
        expect(v.ids[i]).toBe(row);
        expect(v.columns[0]![i]).toBe(row * 10);
        expect(v.columns[1]![i]).toBeCloseTo(row + 0.5, 10);
      }
    }
  });

  it("maps the f64 column as a Float64Array and the rest as Int32Array", async () => {
    const { e, h } = await seeded(10);
    const v = readView(e, h, 0, 10, SCHEMA)!;

    expect(v.ids).toBeInstanceOf(Int32Array);
    expect(v.columns[0]).toBeInstanceOf(Int32Array);
    expect(v.columns[1]).toBeInstanceOf(Float64Array);
    // A string column carries dictionary ids, so it is an Int32Array too.
    expect(v.columns[2]).toBeInstanceOf(Int32Array);
  });

  it("clamps a window that runs past the end", async () => {
    const { e, h } = await seeded(10);

    expect(readView(e, h, 8, 50, SCHEMA)!.ids.length).toBe(2);
    expect(readView(e, h, 10, 50, SCHEMA)!.ids.length).toBe(0);
    expect(readView(e, h, 999, 50, SCHEMA)!.ids.length).toBe(0);
    expect(readView(e, h, -5, 2, SCHEMA)!.ids.length).toBe(2);
    expect(readView(e, h, 0, 0, SCHEMA)!.ids.length).toBe(0);
    expect(readView(e, h, 0, -1, SCHEMA)!.ids.length).toBe(0);
  });

  it("agrees with the TS side about where each section starts", async () => {
    const { e, h } = await seeded(7);
    const window = viewPacked(e, h, 0, 7)!;

    // The engine sized the buffer; viewOffsets predicts the same size from
    // the schema alone. If these drift, decodeView reads the wrong bytes.
    expect(viewOffsets(SCHEMA, 7).size).toBe(window.len);
    // And every section it points at is mappable.
    for (const off of viewOffsets(SCHEMA, 7).offsets) {
      expect((window.ptr + off) % 8).toBe(0);
    }
  });

  it("reuses one buffer across calls", async () => {
    const { e, h } = await seeded(1000);

    // The first call sizes the buffer; the next two must land on it.
    viewPacked(e, h, 0, 50);
    const second = viewPacked(e, h, 0, 50)!;
    const third = viewPacked(e, h, 50, 50)!;

    expect(third.ptr).toBe(second.ptr);
    expect(third.len).toBe(second.len);
  });

  it("returns 0 for a bad handle rather than a pointer", async () => {
    const e = await newEngine();
    expect(e.view(99, 0, 50)).toBe(0n);
    expect(e.dictSince(99, 0, 0)).toBe(0n);
  });

  it("returns 0 from dictSince for a column that is not a string", async () => {
    const { e, h } = await seeded(4);
    expect(e.dictSince(h, 0, 0)).toBe(0n);
    expect(e.dictSince(h, 99, 0)).toBe(0n);
  });
});

/* ------------------------------------------------------------------ */
/* Dictionary mirror                                                   */
/* ------------------------------------------------------------------ */

describe("dictionary mirror", () => {
  it("sends only what was added since the last known length", async () => {
    const e = await newEngine();
    const h = createTable(e, SCHEMA);

    insertColumns(e, h, [
      { type: ColumnType.I32, values: [1, 2] },
      { type: ColumnType.F64, values: [1, 2] },
      { type: ColumnType.String, values: ["new", "shipped"] },
    ]);

    const mirror = readDictSince(e, h, 2, 0)!;
    expect(mirror).toEqual(["new", "shipped"]);
    expect(e.dictLen(h, 2)).toBe(2);

    const before = e.dictLen(h, 2);
    expect(setCellString(e, h, 0, 2, "cancelled")).toBe(Status.OK);

    // Exactly the one new entry, not the whole dictionary again.
    expect(readDictSince(e, h, 2, before)).toEqual(["cancelled"]);
    expect(e.dictLen(h, 2)).toBe(3);
  });

  it("returns nothing when the mirror is already current", async () => {
    const { e, h } = await seeded(10);
    const len = e.dictLen(h, 2);
    expect(readDictSince(e, h, 2, len)).toEqual([]);
    expect(readDictSince(e, h, 2, len + 100)).toEqual([]);
  });

  it("reuses an id rather than appending when a value repeats", async () => {
    const { e, h } = await seeded(60); // six labels, cycled
    expect(e.dictLen(h, 2)).toBe(LABELS.length);

    const v = readView(e, h, 0, 12, SCHEMA)!;
    expect([...v.columns[2]!]).toEqual([0, 1, 2, 3, 4, 5, 0, 1, 2, 3, 4, 5]);
  });

  it("keeps an id meaning the same after the last cell using it is overwritten", async () => {
    const { e, h } = await seeded(6);
    const before = readDictSince(e, h, 2, 0)!;

    for (let row = 0; row < 6; row++) {
      expect(setCellString(e, h, row, 2, "new")).toBe(Status.OK);
    }

    // Append-only: ids already handed to JS must never change meaning.
    expect(readDictSince(e, h, 2, 0)).toEqual(before);
  });
});

/* ------------------------------------------------------------------ */
/* Scale and memory growth                                             */
/* ------------------------------------------------------------------ */

describe("at 200k rows", () => {
  const ROWS = 200_000;

  it("loads in one insertColumns and reads windows anywhere", async () => {
    const { e, h } = await seeded(ROWS);

    expect(e.rowCount(h)).toBe(ROWS);
    expect(e.dictLen(h, 2)).toBe(LABELS.length);

    for (const start of [0, ROWS / 2, ROWS - 50]) {
      const v = readView(e, h, start, 50, SCHEMA)!;
      expect(v.ids.length, `start ${start}`).toBe(50);
      expect(v.ids[0]).toBe(start);
      expect(v.columns[0]![0]).toBe(start * 10);
      expect(v.columns[1]![0]).toBeCloseTo(start + 0.5, 10);
      expect(v.columns[2]![0]).toBe(start % LABELS.length);
    }
  });

  it("survives linear memory growing under it", async () => {
    const { e, h } = await seeded(1000);

    const before = readView(e, h, 0, 50, SCHEMA)!;
    expect(before.columns[1]![10]).toBeCloseTo(10.5, 10);
    const bytesBefore = e.memory.buffer.byteLength;

    // Big enough that the module must grow, which detaches every typed
    // array taken before it. Anything caching a view over memory.buffer
    // breaks here and nowhere else.
    const ids = new Int32Array(ROWS);
    const prices = new Float64Array(ROWS);
    const statuses: string[] = new Array(ROWS);
    for (let i = 0; i < ROWS; i++) {
      ids[i] = -i;
      prices[i] = -i - 0.25;
      statuses[i] = LABELS[i % LABELS.length]!;
    }
    expect(
      insertColumns(e, h, [
        { type: ColumnType.I32, values: ids },
        { type: ColumnType.F64, values: prices },
        { type: ColumnType.String, values: statuses },
      ])
    ).toBe(1000);

    expect(e.memory.buffer.byteLength).toBeGreaterThan(bytesBefore);
    expect(e.rowCount(h)).toBe(1000 + ROWS);

    // The original rows still read correctly...
    const after = readView(e, h, 0, 50, SCHEMA)!;
    expect([...after.ids]).toEqual([...before.ids]);
    expect(after.columns[1]![10]).toBeCloseTo(10.5, 10);

    // ...and so do the new ones, read through a freshly taken view.
    const appended = readView(e, h, 1000, 3, SCHEMA)!;
    expect([...appended.ids]).toEqual([1000, 1001, 1002]);
    expect([...appended.columns[0]!]).toEqual([0, -1, -2]);
    expect(appended.columns[1]![1]).toBeCloseTo(-1.25, 10);
  });

  it("edits and deletes at depth", async () => {
    const { e, h } = await seeded(ROWS);

    expect(e.setCellF64(h, ROWS - 1, 1, 42.5)).toBe(Status.OK);
    expect(readView(e, h, ROWS - 1, 1, SCHEMA)!.columns[1]![0]).toBe(42.5);

    const doomed = Int32Array.from({ length: 1000 }, (_, i) => i * 7);
    expect(deleteRows(e, h, doomed)).toBe(Status.OK);
    expect(e.rowCount(h)).toBe(ROWS - 1000);
    expect(e.totalRows(h)).toBe(ROWS);

    // Row 0 went; the window now starts at the first survivor.
    expect(readView(e, h, 0, 1, SCHEMA)!.ids[0]).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* Dropped handles                                                     */
/* ------------------------------------------------------------------ */

describe("a dropped handle", () => {
  it("reports BadHandle from every export that returns a status", async () => {
    const { e, h } = await seeded(4);
    expect(e.dropTable(h)).toBe(Status.OK);

    const calls: Array<[string, () => number]> = [
      ["dropTable", () => e.dropTable(h)],
      ["insertColumns", () => e.insertColumns(h, 0, 3)],
      ["setCellI32", () => e.setCellI32(h, 0, 0, 1)],
      ["setCellF64", () => e.setCellF64(h, 0, 1, 1)],
      ["setCellString", () => e.setCellString(h, 0, 2, 0, 0)],
      ["deleteRows", () => e.deleteRows(h, 0, 0)],
      ["revision", () => e.revision(h)],
      ["rowCount", () => e.rowCount(h)],
      ["totalRows", () => e.totalRows(h)],
      ["dictLen", () => e.dictLen(h, 2)],
    ];

    for (const [name, call] of calls) {
      expect(call(), name).toBe(Status.BadHandle);
    }

    // The two buffer-returning exports have no room for a status, so they
    // use the packed-zero failure value instead.
    expect(e.view(h, 0, 50)).toBe(0n);
    expect(e.dictSince(h, 2, 0)).toBe(0n);
  });

  it("reports BadHandle for a handle that was never issued", async () => {
    const e = await newEngine();
    for (const h of [0, -1, 99]) {
      expect(e.rowCount(h), `handle ${h}`).toBe(Status.BadHandle);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Drift guards                                                        */
/* ------------------------------------------------------------------ */

describe("the module, the manifest and the bindings agree", () => {
  it("exports exactly what the audit manifest requires", async () => {
    const { ABI_EXPORTS, TOLERATED_EXPORTS, RUNTIME_EXPORTS } =
      await import("../scripts/engine-exports.mjs");
    const e = await newEngine();
    const present = new Set(Object.keys(e));

    for (const name of [...RUNTIME_EXPORTS, ...ABI_EXPORTS]) {
      expect(present.has(name), `missing export ${name}`).toBe(true);
    }

    const known = new Set([...RUNTIME_EXPORTS, ...ABI_EXPORTS, ...TOLERATED_EXPORTS]);
    for (const name of present) {
      expect(known.has(name), `undeclared export ${name}`).toBe(true);
    }
  });

  it("declares the same ABI names in abi.ts as in the manifest", async () => {
    const { ABI_EXPORTS } = await import("../scripts/engine-exports.mjs");
    // The audit and the TS bindings are written separately and must not
    // drift: a name in one and not the other is an export nobody can call.
    expect([...ENGINE_EXPORTS]).toEqual(ABI_EXPORTS);
  });
});

/* ------------------------------------------------------------------ */
/* Churn                                                               */
/* ------------------------------------------------------------------ */

describe("under churn", () => {
  it("keeps stored rows intact while memory is allocated and freed around them", async () => {
    const { e, h } = await seeded(2000);

    for (let round = 0; round < 40; round++) {
      const ptr = e.alloc(64 * 1024);
      expect(ptr).toBeGreaterThan(0);
      e.free(ptr);

      expect(setCellString(e, h, round, 2, `churn-${round}`)).toBe(Status.OK);
      readView(e, h, round, 50, SCHEMA);
    }

    const v = readView(e, h, 100, 50, SCHEMA)!;
    for (let i = 0; i < 50; i++) {
      const row = 100 + i;
      expect(v.ids[i]).toBe(row);
      expect(v.columns[0]![i]).toBe(row * 10);
      expect(v.columns[1]![i]).toBeCloseTo(row + 0.5, 10);
    }

    // The dictionary grew by one entry per edited row and kept every one.
    expect(e.dictLen(h, 2)).toBe(LABELS.length + 40);
    const dict = readDictSince(e, h, 2, 0)!;
    expect(dict.slice(LABELS.length)).toEqual(Array.from({ length: 40 }, (_, i) => `churn-${i}`));
  });

  it("stays correct across repeated large inserts", async () => {
    const e = await newEngine();
    const h = createTable(e, SCHEMA);

    const ROWS = 20_000;
    const ids = Int32Array.from({ length: ROWS }, (_, i) => i);
    const prices = Float64Array.from({ length: ROWS }, (_, i) => i + 0.5);
    const statuses = Array.from({ length: ROWS }, (_, i) => LABELS[i % LABELS.length]!);

    for (let batch = 0; batch < 8; batch++) {
      expect(
        insertColumns(e, h, [
          { type: ColumnType.I32, values: ids },
          { type: ColumnType.F64, values: prices },
          { type: ColumnType.String, values: statuses },
        ])
      ).toBe(batch * ROWS);
    }

    expect(e.rowCount(h)).toBe(ROWS * 8);
    // Nothing is asserted about linear memory here on purpose. The module
    // ships with TinyGo's leaking collector, so it grows and never shrinks;
    // see the note in scripts/build-wasm.mjs. What has to hold is that the
    // rows are still right after the heap has moved around underneath them.
    const v = readView(e, h, ROWS * 7, 3, SCHEMA)!;
    expect([...v.columns[0]!]).toEqual([0, 1, 2]);
    expect(v.columns[1]![2]).toBeCloseTo(2.5, 10);
    expect(e.dictLen(h, 2)).toBe(LABELS.length);
  });
});

/* ------------------------------------------------------------------ */
/* Engine-owned buffers                                                */
/* ------------------------------------------------------------------ */

describe("the engine's own buffers", () => {
  it("hands back the same input pointer when nothing has to grow", async () => {
    const e = await newEngine();

    const first = e.inputBuffer(256);
    expect(first).toBeGreaterThan(0);
    expect(first % 8).toBe(0);
    expect(e.inputBuffer(256)).toBe(first);
    // A smaller ask fits in what is already there.
    expect(e.inputBuffer(64)).toBe(first);

    // A bigger one may move it, and must still be aligned.
    const grown = e.inputBuffer(1024 * 1024);
    expect(grown % 8).toBe(0);
    // ...and from then on the larger buffer serves the smaller asks.
    expect(e.inputBuffer(64)).toBe(grown);
  });

  it("returns 0 for a non-positive input size", async () => {
    const e = await newEngine();
    expect(e.inputBuffer(0)).toBe(0);
    expect(e.inputBuffer(-1)).toBe(0);
  });

  it("hands back the same view pointer across calls of the same size", async () => {
    const { e, h } = await seeded(1000);

    viewPacked(e, h, 0, 50);
    const second = viewPacked(e, h, 0, 50)!;
    const third = viewPacked(e, h, 50, 50)!;

    expect(third.ptr).toBe(second.ptr);
    expect(third.len).toBe(second.len);
  });

  it("hands back the same dictionary pointer across calls of the same size", async () => {
    const { e, h } = await seeded(60);

    dictPacked(e, h, 2, 0);
    const second = dictPacked(e, h, 2, 0)!;
    const third = dictPacked(e, h, 2, 0)!;

    // It used to be freshly allocated and freed by JS on every call.
    expect(third.ptr).toBe(second.ptr);
    expect(third.len).toBe(second.len);
  });

  it("keeps the input, view and dictionary buffers apart", async () => {
    const { e, h } = await seeded(100);

    const input = e.inputBuffer(1024);
    const view = viewPacked(e, h, 0, 50)!;
    const dict = dictPacked(e, h, 2, 0)!;

    // A reply that landed on top of its own request would corrupt the next
    // call that reused the arguments.
    const overlaps = (a: { ptr: number; len: number }, b: { ptr: number; len: number }) =>
      a.ptr < b.ptr + b.len && b.ptr < a.ptr + a.len;

    expect(overlaps({ ptr: input, len: 1024 }, view)).toBe(false);
    expect(overlaps({ ptr: input, len: 1024 }, dict)).toBe(false);
    expect(overlaps(view, dict)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* withInput                                                           */
/* ------------------------------------------------------------------ */

describe("withInput", () => {
  it("lays several arguments out in one buffer, each 8-byte aligned", async () => {
    const e = await newEngine();

    withInput(
      e,
      [i32In([1, 2, 3]), f64In([1.5, 2.5]), stringIn("héllo"), bytesIn(new Uint8Array([9]))],
      ([ints, floats, text, raw]) => {
        for (const block of [ints, floats, text, raw]) {
          expect(block.ptr % 8, "every block starts aligned").toBe(0);
        }

        // len is what the engine's parameter means: elements for arrays,
        // bytes for strings.
        expect(ints.len).toBe(3);
        expect(ints.byteLength).toBe(12);
        expect(floats.len).toBe(2);
        expect(floats.byteLength).toBe(16);
        expect(text.len).toBe(6); // 5 characters, 6 bytes
        expect(raw.len).toBe(1);

        // Nothing overlaps, and the values survive the round trip.
        expect([...new Int32Array(e.memory.buffer, ints.ptr, 3)]).toEqual([1, 2, 3]);
        expect([...new Float64Array(e.memory.buffer, floats.ptr, 2)]).toEqual([1.5, 2.5]);
        expect(new TextDecoder().decode(new Uint8Array(e.memory.buffer, text.ptr, text.len))).toBe(
          "héllo"
        );
      }
    );
  });

  it("writes f64 data somewhere a Float64Array can be mapped", async () => {
    const e = await newEngine();
    // An odd-length i32 argument first, so the f64 block has to be padded
    // past an offset that is only 4-aligned.
    withInput(e, [i32In([1, 2, 3]), f64In([0.1, 0.2])], ([, floats]) => {
      expect(floats.ptr % 8).toBe(0);
      expect(() => new Float64Array(e.memory.buffer, floats.ptr, 2)).not.toThrow();
      expect([...new Float64Array(e.memory.buffer, floats.ptr, 2)]).toEqual([0.1, 0.2]);
    });
  });

  it("is correct after the input buffer has had to grow", async () => {
    const e = await newEngine();
    const h = createTable(e, SCHEMA);

    // Start small, then jump well past it. Growing moves the buffer, so a
    // helper that asked for it before sizing everything would hand out
    // offsets into the old block.
    expect(
      insertColumns(e, h, [
        { type: ColumnType.I32, values: [1] },
        { type: ColumnType.F64, values: [1.5] },
        { type: ColumnType.String, values: ["a"] },
      ])
    ).toBe(0);

    const big = 50_000;
    const ids = Int32Array.from({ length: big }, (_, i) => i);
    const prices = Float64Array.from({ length: big }, (_, i) => i + 0.25);
    const statuses = Array.from({ length: big }, (_, i) => LABELS[i % LABELS.length]!);

    expect(
      insertColumns(e, h, [
        { type: ColumnType.I32, values: ids },
        { type: ColumnType.F64, values: prices },
        { type: ColumnType.String, values: statuses },
      ])
    ).toBe(1);

    // Both batches read back correctly, so no descriptor pointed at a
    // stale offset.
    const first = readView(e, h, 0, 1, SCHEMA)!;
    expect(first.columns[0]![0]).toBe(1);
    expect(first.columns[1]![0]).toBe(1.5);

    const last = readView(e, h, big, 1, SCHEMA)!;
    expect(last.columns[0]![0]).toBe(big - 1);
    expect(last.columns[1]![0]).toBeCloseTo(big - 1 + 0.25, 10);
  });

  it("handles an operation whose arguments are all empty", async () => {
    const e = await newEngine();
    const h = createTable(e, SCHEMA);

    // No buffer is needed at all, and the engine reads a null pointer with
    // a zero length as "nothing".
    expect(deleteRows(e, h, [])).toBe(Status.OK);
    expect(
      withInput(e, [i32In([])], ([block]) => {
        expect(block.ptr).toBe(0);
        expect(block.len).toBe(0);
        return Status.OK;
      })
    ).toBe(Status.OK);
  });

  it("returns whatever the body returns", async () => {
    const e = await newEngine();
    expect(withInput(e, [i32In([1])], () => "done")).toBe("done");
  });
});

/* ------------------------------------------------------------------ */
/* The view header                                                     */
/* ------------------------------------------------------------------ */

describe("the view header", () => {
  it("reports where the window actually begins", async () => {
    const { e, h } = await seeded(10);

    const cases: Array<[string, number, number, number, number]> = [
      // name, requested start, count, expected start, expected rows
      ["exact", 0, 3, 0, 3],
      ["middle", 4, 3, 4, 3],
      ["clamped at the end", 8, 10, 8, 2],
      ["past the end", 50, 10, 10, 0],
      ["negative start", -5, 2, 0, 2],
    ];

    for (const [name, start, count, wantStart, wantRows] of cases) {
      const v = readView(e, h, start, count, SCHEMA)!;
      expect(v.start, name).toBe(wantStart);
      expect(v.ids.length, name).toBe(wantRows);
    }
  });

  it("reports a start that moved because rows were deleted", async () => {
    const { e, h } = await seeded(10);
    expect(deleteRows(e, h, [0, 1, 2, 3, 4, 5, 6, 7])).toBe(Status.OK);

    // Two rows left, so a request for row 5 lands at the end. Without the
    // start on the wire JS could not tell that from an empty table.
    const v = readView(e, h, 5, 10, SCHEMA)!;
    expect(v.start).toBe(2);
    expect(v.ids.length).toBe(0);
  });
});
