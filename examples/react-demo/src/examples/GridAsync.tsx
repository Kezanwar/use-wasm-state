import { useWasmDataGridAsync } from "use-wasm-state/datagrid";
import { Orders } from "@/components/Orders";
import { orders } from "@/lib/orders";

export function GridAsync() {
  const { grid, error } = useWasmDataGridAsync(orders);
  return <Orders grid={grid} error={error} />;
}
