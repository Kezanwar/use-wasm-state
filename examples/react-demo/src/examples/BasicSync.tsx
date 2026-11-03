import { useDataGridView, useWasmDataGridSync } from "use-wasm-state/datagrid";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { basket, SEED } from "./basket";

export function BasicSync() {
  const { status, grid } = useWasmDataGridSync(basket, { initialRows: SEED });
  const view = useDataGridView(grid, 0, 50);

  if (status !== "ready" || !view)
    return <div className="bg-muted/40 h-40 animate-pulse rounded-md" />;

  return (
    <div className="space-y-3">
      <table className="w-full text-sm" data-testid="basic-table">
        <thead className="text-muted-foreground text-left text-xs">
          <tr>
            <th className="py-1 font-medium">Item</th>
            <th className="py-1 text-right font-medium">Qty</th>
            <th className="py-1 text-right font-medium">Price</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {view.rows().map((row, i) => {
            const rowId = view.ids[i]!;
            return (
              <tr key={rowId} className="border-border/50 border-t">
                <td className="py-1.5">
                  <input
                    className="w-full bg-transparent outline-none"
                    value={row.item}
                    onChange={(e) => grid.setCell(rowId, "item", e.target.value)}
                  />
                </td>
                <td className="tabular py-1.5 text-right">
                  <input
                    type="number"
                    className="w-16 bg-transparent text-right outline-none"
                    value={row.qty}
                    onChange={(e) => grid.setCell(rowId, "qty", Number(e.target.value))}
                  />
                </td>
                <td className="tabular py-1.5 text-right">{row.price.toFixed(2)}</td>
                <td className="w-8 py-1.5 text-right">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Delete ${row.item}`}
                    onClick={() => grid.deleteRows([rowId])}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Button
        variant="outline"
        size="sm"
        data-testid="basic-add"
        onClick={() => grid.insertRows([{ item: "New item", qty: 1, price: 0 }])}
      >
        <Plus /> Add row
      </Button>
    </div>
  );
}
