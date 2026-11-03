/**
 * The three things measured, in the order every table shows them.
 */

import { orders } from "../lib/orders";
import type { Implementation, ImplId } from "./runner";
import { createBaselineStore } from "./store";
import { createTunedGrid } from "./tuned";
import { createTypicalGrid } from "./typical";
import { createWasmGrid } from "./wasm";

export const LABELS: Record<ImplId, string> = {
  typical: "Typical JS",
  tuned: "Tuned JS",
  wasm: "Wasm",
};

export function implementations(wasmUrl: string): Implementation[] {
  return [
    {
      id: "typical",
      label: LABELS.typical,
      create: async () => ({
        store: createBaselineStore(createTypicalGrid(orders), orders),
        dispose() {},
      }),
    },
    {
      id: "tuned",
      label: LABELS.tuned,
      create: async () => ({
        store: createBaselineStore(createTunedGrid(orders), orders),
        dispose() {},
      }),
    },
    {
      id: "wasm",
      label: LABELS.wasm,
      create: async () => {
        const grid = await createWasmGrid(orders, wasmUrl);
        return {
          store: grid.store,
          linearMemory: grid.linearMemory,
          liveMemory: grid.liveMemory,
          dispose: grid.dispose,
        };
      },
    },
  ];
}
