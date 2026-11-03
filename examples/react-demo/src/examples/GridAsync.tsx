import { useWasmDataGridAsync } from "use-wasm-state/datagrid";
import { Orders } from "@/components/Orders";
import { orders } from "@/lib/orders";

export function GridAsync() {
  const { grid, error } = useWasmDataGridAsync(orders);
  // A worker answers a window a round trip later, so it reads further
  // ahead. Not much further: every extra row is one more to decode and
  // render on each reply.
  return <Orders grid={grid} error={error} overscan={16} />;
}
