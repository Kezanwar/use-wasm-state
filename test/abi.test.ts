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
  insertColumns,
  newEngine,
  readDictSince,
  readView,
  serveEngine,
  setCellString,
  viewPacked,
  writeBytes,
} from "./helpers/engine";

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

  it("round-trips bytes written from JS", async () => {
    const e = await newEngine();
    const data = new Uint8Array([1, 2, 3, 250, 255]);
    const ptr = writeBytes(e, data);
    expect([...new Uint8Array(e.memory.buffer, ptr, data.length)]).toEqual([...data]);
    e.free(ptr);
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
      const ptr = writeBytes(e, bytes);
      try {
        expect(e.createTable(ptr, bytes.byteLength), name).toBe(Status.BadSchema);
      } finally {
        if (ptr !== 0) e.free(ptr);
      }
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

    // One descriptor pointing at an odd offset. Reinterpreting that as
    // float64s would be undefined behaviour, so it has to be refused.
    const descs = new Uint32Array(SCHEMA.length * 4);
    const base = e.alloc(64);
    descs.set([base + 1, 1, 0, 1], 0);
    descs.set([base + 1, 1, 0, 1], 4);
    descs.set([base + 1, 1, base, 1], 8);
    const descPtr = writeBytes(e, new Uint8Array(descs.buffer));

    expect(e.insertColumns(h, descPtr, SCHEMA.length)).toBe(Status.BadArgument);
    e.free(descPtr);
    e.free(base);
  });

  it("rejects string offsets that run past the blob", async () => {
    const e = await newEngine();
    const h = createTable(e, [{ name: "s", type: ColumnType.String }]);

    const blob = writeBytes(e, new TextEncoder().encode("ab"));
    const offsets = writeBytes(e, new Uint8Array(Uint32Array.from([0, 999]).buffer));
    const descs = Uint32Array.from([blob, 2, offsets, 1]);
    const descPtr = writeBytes(e, new Uint8Array(descs.buffer));

    expect(e.insertColumns(h, descPtr, 1)).toBe(Status.BadArgument);

    e.free(blob);
    e.free(offsets);
    e.free(descPtr);
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
