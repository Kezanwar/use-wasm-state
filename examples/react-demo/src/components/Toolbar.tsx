import { Plus, Search, Trash2 } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { formatCount } from "@/lib/format";
import { STATUSES } from "@/lib/orders";

export interface ToolbarProps {
  mode: "sync" | "worker";
  onMode: (mode: "sync" | "worker") => void;
  selectedCount: number;
  search: string;
  statuses: readonly string[];
  onSearch: (text: string) => void;
  onToggleStatus: (status: string) => void;
  onAppend: () => void;
  onDelete: () => void;
  busy: boolean;
}

/**
 * Everything that shapes the table, in one row.
 *
 * The status chips are the filter: a chip is on or off, and what is on is
 * what you see. Nothing needs a label to say so.
 */
export function Toolbar({
  mode,
  onMode,
  selectedCount,
  search,
  statuses,
  onSearch,
  onToggleStatus,
  onAppend,
  onDelete,
  busy,
}: ToolbarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <div className="relative">
        <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2" />
        <input
          type="search"
          value={search}
          placeholder="Search"
          data-testid="search"
          onChange={(event) => onSearch(event.target.value)}
          className="focus-visible:ring-ring/50 h-7 w-40 rounded-md border bg-transparent pr-2 pl-7 text-sm outline-none focus-visible:ring-[3px]"
        />
      </div>

      <div className="flex items-center gap-1" role="group" aria-label="Status">
        {STATUSES.map((status) => {
          const on = statuses.includes(status);
          return (
            <button
              key={status}
              type="button"
              aria-pressed={on}
              data-testid={`status-${status}`}
              onClick={() => onToggleStatus(status)}
              className={cn(
                "rounded-md border px-2 py-0.5 text-xs transition-colors",
                on
                  ? "border-transparent bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {status}
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Two words, and the one that is on is the one that is running. */}
        <div className="flex items-center rounded-md border p-0.5" role="group" aria-label="Mode">
          {(["sync", "worker"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              data-testid={`mode-${value}`}
              onClick={() => onMode(value)}
              className={cn(
                "rounded px-2 py-0.5 text-xs transition-colors",
                mode === value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {value === "sync" ? "Main thread" : "Worker"}
            </button>
          ))}
        </div>

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
      </div>
    </header>
  );
}
