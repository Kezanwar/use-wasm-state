import { useState, type FormEvent } from "react";
import { WasmStateAsyncProvider } from "use-wasm-state";
import {
  useDataGridQuery,
  useDataGridStats,
  useDataGridView,
  useWasmDataGridAsync,
} from "use-wasm-state/datagrid";
import { ArrowUpDown, Eye, EyeOff, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Basket } from "./basket";

/**
 * Three components, one grid. None of them is handed it: each names the
 * definition and the provider gives every one the same grid. Hide the list
 * and bring it back, and its rows are still there, because the grid
 * belongs to the provider rather than to whoever is showing it.
 */
export function SharedAsync() {
  const [listed, setListed] = useState(true);

  return (
    <WasmStateAsyncProvider>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <Summary />
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={listed ? "Hide list" : "Show list"}
            data-testid="shared-toggle"
            onClick={() => setListed((on) => !on)}
          >
            {listed ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
          </Button>
        </div>
        {listed && <List />}
        <Editor />
      </div>
    </WasmStateAsyncProvider>
  );
}

function Summary() {
  const { grid } = useWasmDataGridAsync(Basket);
  const stats = useDataGridStats(grid);
  const sort = useDataGridQuery(grid)?.sort[0];

  return (
    <p className="text-muted-foreground font-mono text-xs" data-testid="shared-summary">
      {stats && `${stats.rowCount} items`}
      {sort && ` · ${sort.column} ${sort.direction === "desc" ? "↓" : "↑"}`}
    </p>
  );
}

function List() {
  const { grid } = useWasmDataGridAsync(Basket);
  const view = useDataGridView(grid, 0, 50);

  if (!view) return <div className="bg-muted/40 h-24 animate-pulse rounded-md" />;

  return (
    <ul className="divide-border/50 divide-y text-sm" data-testid="shared-list">
      {view.rows().map((row, i) => (
        <li key={view.ids[i]} className="flex justify-between py-1.5">
          <span>{row.item}</span>
          <span className="text-muted-foreground tabular">
            {row.qty} × {row.price.toFixed(2)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Editor() {
  const { grid } = useWasmDataGridAsync(Basket);
  const sort = useDataGridQuery(grid)?.sort[0];
  const [item, setItem] = useState("");

  const add = async (event: FormEvent) => {
    event.preventDefault();
    const name = item.trim();
    if (!grid || !name) return;
    setItem("");
    await grid.insertRows([{ item: name, qty: 1, price: 0 }]);
  };

  return (
    <form className="flex items-center gap-2" onSubmit={(event) => void add(event)}>
      <input
        value={item}
        onChange={(event) => setItem(event.target.value)}
        placeholder="Item"
        data-testid="shared-input"
        className="focus-visible:ring-ring/50 h-8 min-w-0 flex-1 rounded-md border bg-transparent px-2 text-sm outline-none focus-visible:ring-[3px]"
      />
      <Button type="submit" variant="outline" size="sm" disabled={!grid} data-testid="shared-add">
        <Plus /> Add
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        aria-label="Sort by item"
        data-testid="shared-sort"
        disabled={!grid}
        onClick={() => void grid?.sortBy("item", sort?.direction === "asc" ? "desc" : "asc")}
      >
        <ArrowUpDown className="size-3.5" />
      </Button>
    </form>
  );
}
