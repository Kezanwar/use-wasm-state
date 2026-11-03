import { useWasmDataGridSync } from "use-wasm-state/datagrid";
import { Orders } from "@/components/Orders";
import { orders } from "@/lib/orders";

export function GridSync() {
  const { grid, error } = useWasmDataGridSync(orders);
  return <Orders grid={grid} error={error} overscan={8} />;
}
