#!/usr/bin/env node
/**
 * Times the two calls that decide whether the design works: loading a
 * dataset once, and reading a viewport per frame.
 *
 * The viewport number is the one that matters. It includes decodeView, so
 * it is the whole cost of a scroll step as React would pay it, not just the
 * wasm call.
 *
 * The store numbers at the end go through the public API, so they include
 * the dictionary mirror, the view cache and the row-object building a grid
 * actually pays for. Those are the ones to quote.
 *
 *   node scripts/bench-engine.mjs [path/to/engine.wasm]
 */
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { argv } from "node:process";

const file = resolve(argv[2] ?? "src/wasm/engine.wasm");
const ROWS = 200_000;
const LABELS = ["new", "paid", "picked", "shipped", "held", "cancelled"];

const { instance } = await WebAssembly.instantiate(readFileSync(file), {});
const e = instance.exports;
e._initialize();

const enc = new TextEncoder();
const write = (data) => {
  const ptr = e.alloc(data.byteLength);
  new Uint8Array(e.memory.buffer).set(data, ptr);
  return ptr;
};
const raw = (a) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

// schema: id i32, price f64, status string
const parts = [
  [0, "id"],
  [1, "price"],
  [2, "status"],
];
let size = 4;
for (const [, name] of parts) size += 5 + name.length;
const schema = new Uint8Array(size);
new DataView(schema.buffer).setUint32(0, parts.length, true);
let at = 4;
for (const [type, name] of parts) {
  schema[at] = type;
  new DataView(schema.buffer).setUint32(at + 1, name.length, true);
  schema.set(enc.encode(name), at + 5);
  at += 5 + name.length;
}
const sp = write(schema);
const handle = e.createTable(sp, schema.byteLength);
e.free(sp);
if (handle < 0) throw new Error(`createTable failed: ${handle}`);

const ids = new Int32Array(ROWS);
const prices = new Float64Array(ROWS);
let blobLen = 0;
const offsets = new Uint32Array(ROWS + 1);
for (let i = 0; i < ROWS; i++) {
  ids[i] = i * 10;
  prices[i] = i + 0.5;
  blobLen += LABELS[i % LABELS.length].length;
  offsets[i + 1] = blobLen;
}
const blob = new Uint8Array(blobLen);
let b = 0;
for (let i = 0; i < ROWS; i++) {
  blob.set(enc.encode(LABELS[i % LABELS.length]), b);
  b += LABELS[i % LABELS.length].length;
}

const ip = write(raw(ids));
const pp = write(raw(prices));
const bp = write(blob);
const op = write(raw(offsets));
const dp = write(
  raw(new Uint32Array([ip, ROWS, 0, ROWS, pp, ROWS, 0, ROWS, bp, blobLen, op, ROWS]))
);

const t0 = performance.now();
const first = e.insertColumns(handle, dp, 3);
const insertMs = performance.now() - t0;
if (first < 0) throw new Error(`insertColumns failed: ${first}`);
for (const p of [ip, pp, bp, op, dp]) e.free(p);

/* The per-frame path, measured the way the store will use it. */
const SCHEMA = [{ type: 0 }, { type: 1 }, { type: 2 }];
const alignUp = (n) => (n + 7) & ~7;
function decodeView(bytes, schema) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const n = dv.getUint32(0, true);
  let off = 8;
  const base = bytes.byteOffset;
  const out = { ids: new Int32Array(bytes.buffer, base + off, n).slice(), columns: [] };
  off += n * 4;
  for (const column of schema) {
    off = alignUp(off);
    out.columns.push(
      column.type === 1
        ? new Float64Array(bytes.buffer, base + off, n).slice()
        : new Int32Array(bytes.buffer, base + off, n).slice()
    );
    off += column.type === 1 ? n * 8 : n * 4;
  }
  return out;
}

function timeViews(count, iterations) {
  let sink = 0;
  // Warm the view buffer and let the JIT settle before measuring.
  for (let i = 0; i < 2000; i++) {
    const packed = e.view(handle, i % 1000, count);
    const ptr = Number(packed >> 32n);
    const len = Number(packed & 0xffffffffn);
    sink += decodeView(new Uint8Array(e.memory.buffer, ptr, len), SCHEMA).ids[0];
  }

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const packed = e.view(handle, i % (ROWS - count), count);
    const ptr = Number(packed >> 32n);
    const len = Number(packed & 0xffffffffn);
    sink += decodeView(new Uint8Array(e.memory.buffer, ptr, len), SCHEMA).ids[0];
  }
  const total = performance.now() - start;
  if (sink < 0) throw new Error("unreachable");
  return (total / iterations) * 1000;
}

const viewUs = timeViews(50, 100_000);

const editStart = performance.now();
const EDITS = 2000;
for (let i = 0; i < EDITS; i++) e.setCellF64(handle, i, 1, i + 0.25);
const editUs = ((performance.now() - editStart) / EDITS) * 1000;

console.log(`${file}`);
console.log(`  module size             ${readFileSync(file).byteLength} bytes`);
console.log(`  linear memory           ${(e.memory.buffer.byteLength / 1048576).toFixed(1)}MB`);
console.log(`  insertColumns ${ROWS}  ${insertMs.toFixed(1)}ms`);
console.log(`  view(start, 50) + decode  ${viewUs.toFixed(2)}us`);
console.log(`  setCellF64              ${editUs.toFixed(2)}us`);

/* ------------------------------------------------------------------ */
/* Through the store                                                   */
/* ------------------------------------------------------------------ */

// The built package, so these numbers describe what a consumer installs.
// Run `pnpm build` first.
const distPath = resolve(import.meta.dirname, "../dist/index.js");
if (!existsSync(distPath)) {
  console.error("\nskipping the store benchmarks: dist/ is missing. Run `pnpm build` first.");
  process.exit(0);
}
const { createEngine, defineSchema } = await import(pathToFileURL(distPath).href);

// createEngine loads the module over fetch, which cannot read a local
// path. Serve the file the same way the tests do, so the benchmark
// measures the real load path rather than going around it.
const WASM_URL = "https://engine.bench/engine.wasm";
globalThis.fetch = async () =>
  new Response(readFileSync(file), { headers: { "content-type": "application/wasm" } });

const storeSchema = defineSchema({ id: "i32", price: "f64", status: "string" });

// The same dataset, as columns and as rows.
const statusValues = new Array(ROWS);
for (let i = 0; i < ROWS; i++) statusValues[i] = LABELS[i % LABELS.length];
const rowObjects = new Array(ROWS);
for (let i = 0; i < ROWS; i++) {
  rowObjects[i] = { id: i * 10, price: i + 0.5, status: statusValues[i] };
}

async function freshTable() {
  const engine = await createEngine({ wasmUrl: WASM_URL });
  return { engine, table: engine.createTable(storeSchema) };
}

async function timeStore() {
  const columnar = await freshTable();
  const t1 = performance.now();
  columnar.table.insertColumns({ id: ids, price: prices, status: statusValues });
  const insertColumnsMs = performance.now() - t1;

  const rowwise = await freshTable();
  const t2 = performance.now();
  rowwise.table.insertRows(rowObjects);
  const insertRowsMs = performance.now() - t2;

  const { table } = columnar;

  // Warm the view path, then measure a scroll step as a grid pays for it:
  // the wasm call, the decode, the dictionary resolution and the row
  // objects React renders.
  for (let i = 0; i < 2000; i++) table.view(i % 1000, 50).rows();

  const VIEWS = 50_000;
  const t3 = performance.now();
  let sink = 0;
  for (let i = 0; i < VIEWS; i++) {
    const rows = table.view(i % (ROWS - 50), 50).rows();
    sink += rows[0].id;
  }
  const viewUs = ((performance.now() - t3) / VIEWS) * 1000;

  // A cache hit: the same window at the same revision, which is what
  // useSyncExternalStore asks for on every unrelated re-render.
  const t4 = performance.now();
  for (let i = 0; i < VIEWS; i++) sink += table.view(100, 50).length;
  const cachedUs = ((performance.now() - t4) / VIEWS) * 1000;

  const EDITS = 20_000;
  const t5 = performance.now();
  for (let i = 0; i < EDITS; i++) table.setCell(i, "price", i + 0.25);
  const setCellUs = ((performance.now() - t5) / EDITS) * 1000;

  const t6 = performance.now();
  for (let i = 0; i < EDITS; i++) table.setCell(i, "status", LABELS[i % LABELS.length]);
  const setStringUs = ((performance.now() - t6) / EDITS) * 1000;

  if (sink < 0) throw new Error("unreachable");

  console.log();
  console.log("through the store:");
  console.log(`  insertColumns ${ROWS}  ${insertColumnsMs.toFixed(1)}ms`);
  console.log(`  insertRows ${ROWS}     ${insertRowsMs.toFixed(1)}ms`);
  console.log(`  view(start, 50).rows()    ${viewUs.toFixed(2)}us`);
  console.log(`  view() cache hit          ${cachedUs.toFixed(3)}us`);
  console.log(`  setCell (f64)             ${setCellUs.toFixed(2)}us`);
  console.log(`  setCell (known string)    ${setStringUs.toFixed(2)}us`);
}

await timeStore();
