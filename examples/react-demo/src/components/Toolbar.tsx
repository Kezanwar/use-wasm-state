import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";

export interface ToolbarProps {
  selectedCount: number;
  onAppend: () => void;
  onDelete: () => void;
  busy: boolean;
}

export function Toolbar({ selectedCount, onAppend, onDelete, busy }: ToolbarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <h1 className="mr-auto text-sm font-semibold tracking-tight">Orders</h1>

      {selectedCount > 0 && (
        <Button variant="ghost" size="sm" onClick={onDelete} data-testid="delete">
          <Trash2 />
          {formatCount(selectedCount)}
        </Button>
      )}

      <Button variant="outline" size="sm" onClick={onAppend} disabled={busy} data-testid="append">
        <Plus />
        10,000
      </Button>
    </header>
  );
}
