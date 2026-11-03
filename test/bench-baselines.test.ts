import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { DataGridQuery, DataGridStore } from "../src/datagrid/index";
import { generateOrders, orders } from "../examples/react-demo/src/lib/orders";
import { createBaselineStore } from "../examples/react-demo/src/bench/store";
import { createTunedGrid } from "../examples/react-demo/src/bench/tuned";
import { createTypicalGrid } from "../examples/react-demo/src/bench/typical";
import { createWasmGrid } from "../examples/react-demo/src/bench/wasm";
import { ENGINE_URL, serveEngine } from "./helpers/engine";

/**
 * The benchmark's baselines against the engine.
 *
 * A comparison is only worth publishing if all three do the same work and
 * get the same answer. Every step below runs through the typical baseline,
 * the tuned one and the real store, and after each one their order, their
 * rows and their counts must be identical, ties and case included.
 */

type Schema = typeof orders.spec;
type Query = DataGridQuery<Schema>;

beforeAll(() => serveEngine());
afterAll(() => vi.unstubAllGlobals());

/** Rows chosen to catch case-folding, ties and byte-order tie-breaks. */
const AWKWARD = [
  {
    id: 900001,
    customer: "ada abara",
    status: "PAID",
    country: "Spain",
    qty: 3,
    price: 10,
    created: 1,
  },
  {
    id: 900002,
    customer: "ADA ABARA",
    status: "paid",
    country: "spain",
    qty: 3,
    price: 10,
    created: 1,
  },
  {
    id: 900003,
    customer: "Ada Abara",
    status: "Paid",
    country: "SPAIN",
    qty: 3,
    price: 10,
    created: 1,
  },
  {
    id: 900004,
    customer: "zoe",
    status: "shipped",
    country: "Chile",
    qty: 40,
    price: 0,
    created: 2,
  },
  {
    id: 900005,
    customer: "Zoe",
    status: "Shipped",
    country: "chile",
    qty: 1,
    price: 0,
    created: 2,
  },
];

async function three() {
  const wasm = await createWasmGrid(orders, ENGINE_URL);
  const stores: Record<string, DataGridStore<Schema>> = {
    typical: createBaselineStore(createTypicalGrid(orders), orders),
    tuned: createBaselineStore(createTunedGrid(orders), orders),
    wasm: wasm.store,
  };
  return stores;
}

/** Everything a reader could see, in a form toEqual can compare. */
function snapshot(store: DataGridStore<Schema>) {
  const view = store.view(0, store.rowCount);
  return {
    rowCount: store.rowCount,
    totalRows: store.totalRows,
    ids: [...view.ids],
    rows: view.rows().map((row) => ({ ...row })),
  };
}

function same(stores: Record<string, DataGridStore<Schema>>, step: string) {
  const reference = snapshot(stores.wasm!);
  for (const name of ["typical", "tuned"]) {
    expect(snapshot(stores[name]!), `${name} after ${step}`).toEqual(reference);
  }
}

const QUERIES: [string, Query][] = [
  ["price asc", { sort: [{ column: "price" }] }],
  ["price desc", { sort: [{ column: "price", direction: "desc" }] }],
  ["qty asc, many ties", { sort: [{ column: "qty" }] }],
  ["qty desc, ties stay in id order", { sort: [{ column: "qty", direction: "desc" }] }],
  ["customer asc, case-folded", { sort: [{ column: "customer" }] }],
  ["customer desc", { sort: [{ column: "customer", direction: "desc" }] }],
  [
    "status, then price desc",
    { sort: [{ column: "status" }, { column: "price", direction: "desc" }] },
  ],
  [
    "three keys",
    { sort: [{ column: "country" }, { column: "qty", direction: "desc" }, { column: "customer" }] },
  ],
  ["qty eq", { filters: [{ column: "qty", op: "eq", value: 3 }] }],
  ["qty ne", { filters: [{ column: "qty", op: "ne", value: 3 }] }],
  ["price lt", { filters: [{ column: "price", op: "lt", value: 100 }] }],
  ["price le", { filters: [{ column: "price", op: "le", value: 10 }] }],
  ["price gt", { filters: [{ column: "price", op: "gt", value: 2000 }] }],
  ["price ge", { filters: [{ column: "price", op: "ge", value: 2000 }] }],
  ["price between, inclusive", { filters: [{ column: "price", op: "between", value: [10, 500] }] }],
  ["status eq is exact", { filters: [{ column: "status", op: "eq", value: "paid" }] }],
  ["status ne", { filters: [{ column: "status", op: "ne", value: "paid" }] }],
  [
    "status in",
    { filters: [{ column: "status", op: "in", value: ["paid", "Shipped", "refunded"] }] },
  ],
  ["contains ignores case", { filters: [{ column: "customer", op: "contains", value: "ADA" }] }],
  ["empty contains matches all", { filters: [{ column: "country", op: "contains", value: "" }] }],
  [
    "two filters AND",
    {
      filters: [
        { column: "status", op: "eq", value: "paid" },
        { column: "qty", op: "gt", value: 20 },
      ],
    },
  ],
  ["search every string column", { search: "an" }],
  ["search ignores case", { search: "SHIP" }],
  ["search that matches nothing", { search: "qqqq" }],
  [
    "filter + search + sort",
    {
      filters: [{ column: "status", op: "in", value: ["paid", "shipped", "PAID"] }],
      search: "a",
      sort: [{ column: "price", direction: "desc" }],
    },
  ],
  ["cleared", {}],
];

describe("the benchmark baselines", () => {
  it("agree with the engine on every query", async () => {
    const stores = await three();
    for (const store of Object.values(stores)) {
      store.insertColumns(generateOrders(4000));
      store.insertRows(AWKWARD);
    }
    same(stores, "load");

    for (const [name, query] of QUERIES) {
      for (const store of Object.values(stores)) store.setQuery(query);
      same(stores, name);
    }
  });

  it("agree after edits, deletes and inserts under an active query", async () => {
    const stores = await three();
    const all = Object.values(stores);
    for (const store of all) store.insertColumns(generateOrders(3000));

    const query: Query = {
      filters: [{ column: "qty", op: "ge", value: 10 }],
      search: "e",
      sort: [{ column: "customer", direction: "desc" }, { column: "price" }],
    };
    for (const store of all) store.setQuery(query);
    same(stores, "query");

    // An edit that moves a row, one that drops it out of the filter, and a
    // string the dictionary has never held.
    for (const store of all) {
      store.setCell(5, "price", 0.01);
      store.setCell(6, "qty", 1);
      store.setCell(7, "customer", "Brand New Name");
    }
    same(stores, "edits");

    for (const store of all) store.deleteRows([0, 1, 2, 100, 2999]);
    same(stores, "deletes");

    for (const store of all) store.insertRows(AWKWARD);
    same(stores, "insert under a query");

    for (const store of all) store.clearQuery();
    same(stores, "clear");

    // With no query, deletes and edits take the shortcut path.
    for (const store of all) {
      store.deleteRows([10, 11]);
      store.setCell(12, "status", "held");
    }
    same(stores, "edits with no query");
  });

  it("clamp windows the way the engine does", async () => {
    const stores = await three();
    for (const store of Object.values(stores)) store.insertColumns(generateOrders(100));

    for (const [start, count] of [
      [-5, 10],
      [95, 10],
      [100, 5],
      [250, 5],
      [10, -3],
    ] as const) {
      const expected = stores.wasm!.view(start, count);
      for (const name of ["typical", "tuned"]) {
        const view = stores[name]!.view(start, count);
        expect([view.start, view.length], `${name} view(${start}, ${count})`).toEqual([
          expected.start,
          expected.length,
        ]);
      }
    }
  });
});
