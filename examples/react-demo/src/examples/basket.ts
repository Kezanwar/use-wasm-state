import { defineDataGrid, defineSchema } from "use-wasm-state/datagrid";

export const basket = defineSchema({ item: "string", qty: "i32", price: "f64" });

export const SEED = [
  { item: "Keyboard", qty: 2, price: 89 },
  { item: "Monitor", qty: 1, price: 329.5 },
  { item: "Cable", qty: 8, price: 4.25 },
];

/** One basket, shared by every component that names it. */
export const Basket = defineDataGrid("basket", basket, { initialRows: SEED });
