import { defineSchema } from "use-wasm-state/datagrid";

/**
 * The dataset, generated the same way on every load.
 *
 * Columns rather than rows: that is the shape the engine takes, and
 * building 200k objects just to take them apart again is the slow way to
 * do this. A seeded generator means the grid, the benchmarks and the
 * browser tests all see identical data.
 */

export const orders = defineSchema({
  id: "i32",
  customer: "string",
  status: "string",
  country: "string",
  qty: "i32",
  price: "f64",
  created: "i32",
});

export type Order = {
  id: number;
  customer: string;
  status: string;
  country: string;
  qty: number;
  price: number;
  created: number;
};

export const STATUSES = ["pending", "paid", "shipped", "cancelled", "refunded"];

const FIRST = `Ada Alan Amara Anika Arjun Beatriz Bilal Camila Chen Dara Diego Elena Emeka Farah
Freya Gabriel Hana Hugo Ines Isla Jonas Juno Kai Kenji Lars Leila Lior Luca Maya Mei Mila Nadia
Niall Nina Noor Oleg Omar Otto Paloma Petra Rafael Rania Ravi Rosa Sana Sven Tariq Tessa Theo
Tomas Uma Vera Viktor Wen Yara Yusuf Zara Zoe Aiko Bram Cato Dilan Edda Finn Gita Halle Ivo Jana`
  .split(/\s+/)
  .filter(Boolean);

const LAST = `Abara Adeyemi Alvarez Andersen Bakshi Bergman Bianchi Cardoso Chaudhry Costa Dahl
Dimitriou Dubois Edwards Eriksen Farouk Fischer Fontaine Garcia Gupta Haddad Hansen Hoffman Ibrahim
Ivanov Jensen Kaur Keller Khan Kowalski Laurent Lindqvist Lombardi Macdonald Mahmood Martins
Mensah Mitchell Moreau Nakamura Navarro Nguyen Nowak Okafor Olsen Ortega Pavlov Pereira Petrov
Quinn Rahman Ramirez Reyes Ricci Rossi Sato Schneider Silva Sorensen Suzuki Tanaka Thompson Torres
Vargas Virtanen Wagner Walsh Weber Yilmaz Zhang Zimmerman`
  .split(/\s+/)
  .filter(Boolean);

const COUNTRIES = `Argentina Australia Austria Belgium Brazil Canada Chile Denmark Egypt Finland
France Germany Ghana India Ireland Italy Japan Kenya Mexico Netherlands Nigeria Norway Poland
Portugal Singapore Spain Sweden Switzerland Turkey Vietnam`
  .split(/\s+/)
  .filter(Boolean);

/** mulberry32: small, fast, and identical in every browser. */
function seeded(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface OrderColumns {
  id: Int32Array;
  customer: string[];
  status: string[];
  country: string[];
  qty: Int32Array;
  price: Float64Array;
  created: Int32Array;
}

/**
 * Generate `count` orders, starting at row id `from`.
 *
 * The customer column draws from first x last names, so around five
 * thousand distinct values over two hundred thousand rows: exactly the
 * shape dictionary encoding is for.
 */
export function generateOrders(count: number, from = 0): OrderColumns {
  const random = seeded(0x5eed + from);

  const id = new Int32Array(count);
  const qty = new Int32Array(count);
  const price = new Float64Array(count);
  const created = new Int32Array(count);
  const customer = new Array<string>(count);
  const status = new Array<string>(count);
  const country = new Array<string>(count);

  // Days since epoch, over the three years to a fixed day rather than to
  // today, so the data is identical on every machine and every day.
  const today = 20_395;

  for (let i = 0; i < count; i++) {
    id[i] = from + i + 1;
    customer[i] = `${FIRST[(random() * FIRST.length) | 0]} ${LAST[(random() * LAST.length) | 0]}`;
    status[i] = STATUSES[(random() * STATUSES.length) | 0]!;
    country[i] = COUNTRIES[(random() * COUNTRIES.length) | 0]!;
    qty[i] = 1 + ((random() * 40) | 0);
    price[i] = Math.round(random() * 250_000) / 100;
    created[i] = today - ((random() * 1095) | 0);
  }

  return { id, customer, status, country, qty, price, created };
}
