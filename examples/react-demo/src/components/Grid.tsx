import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "cn";
import { useTableView, type TableStore } from "use-wasm-state";
import { useVirtualWindow } from "@/hooks/useVirtualWindow";
import { formatDate, formatPrice } from "@/lib/format";
import type { Order, schema } from "@/lib/orders";

type Schema = typeof schema.spec;

const ROW_HEIGHT = 32;

/** Column layout. `align` and `format` are the only per-column behaviour. */
const COLUMNS = [
  { key: "id", label: "ID", width: "5rem", align: "right" },
  { key: "customer", label: "Customer", width: "minmax(10rem, 1fr)", align: "left" },
  { key: "status", label: "Status", width: "7rem", align: "left" },
  { key: "country", label: "Country", width: "9rem", align: "left" },
  { key: "qty", label: "Qty", width: "4.5rem", align: "right" },
  { key: "price", label: "Price", width: "8rem", align: "right", format: formatPrice },
  { key: "created", label: "Created", width: "8rem", align: "right", format: formatDate },
] as const satisfies readonly {
  key: keyof Order;
  label: string;
  width: string;
  align: "left" | "right";
  format?: (value: never) => string;
}[];

const TEMPLATE = COLUMNS.map((c) => c.width).join(" ");

/** Where the keyboard is. `row` is an offset into the live order, not a row id. */
interface Cursor {
  row: number;
  col: number;
}

/** A contiguous run of selected rows, by offset. */
interface Selection {
  anchor: number;
  focus: number;
}

export const selectionRange = (s: Selection) => ({
  from: Math.min(s.anchor, s.focus),
  to: Math.max(s.anchor, s.focus),
});

export interface GridProps {
  table: TableStore<Schema>;
  rowCount: number;
  selection: Selection | null;
  onSelectionChange: (selection: Selection | null) => void;
  onEdit: (run: () => void) => void;
}

export function Grid({ table, rowCount, selection, onSelectionChange, onEdit }: GridProps) {
  const window = useVirtualWindow(rowCount, ROW_HEIGHT);
  const view = useTableView(table, window.start, window.count);

  const [cursor, setCursor] = useState<Cursor>({ row: 0, col: 0 });
  const [editing, setEditing] = useState(false);

  const move = useCallback(
    (rowDelta: number, colDelta: number) => {
      setCursor((current) => {
        const row = Math.max(0, Math.min(rowCount - 1, current.row + rowDelta));
        const col = Math.max(0, Math.min(COLUMNS.length - 1, current.col + colDelta));
        window.scrollToRow(row);
        return { row, col };
      });
    },
    [rowCount, window]
  );

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (editing) return;

    switch (event.key) {
      case "ArrowDown":
        move(1, 0);
        break;
      case "ArrowUp":
        move(-1, 0);
        break;
      case "ArrowRight":
        move(0, 1);
        break;
      case "ArrowLeft":
        move(0, -1);
        break;
      case "PageDown":
        move(20, 0);
        break;
      case "PageUp":
        move(-20, 0);
        break;
      case "Enter":
        setEditing(true);
        break;
      case "Escape":
        onSelectionChange(null);
        return;
      default:
        return;
    }
    event.preventDefault();
  };

  const select = (row: number, extend: boolean) => {
    onSelectionChange(
      extend && selection ? { anchor: selection.anchor, focus: row } : { anchor: row, focus: row }
    );
    setCursor((c) => ({ ...c, row }));
  };

  const selected = selection ? selectionRange(selection) : null;

  return (
    <div
      className="min-h-0 flex-1 select-none overflow-auto outline-none"
      ref={window.ref}
      tabIndex={0}
      onKeyDown={onKeyDown}
      data-testid="grid"
      role="grid"
      aria-rowcount={rowCount}
    >
      <div
        className="sticky top-0 z-10 grid border-b bg-background/95 text-xs font-medium text-muted-foreground backdrop-blur"
        style={{ gridTemplateColumns: TEMPLATE, height: ROW_HEIGHT }}
      >
        {COLUMNS.map((column) => (
          <div
            key={column.key}
            className={cn("truncate px-3 leading-8", column.align === "right" && "text-right")}
          >
            {column.label}
          </div>
        ))}
      </div>

      {/* Sized to the whole table so the scrollbar tells the truth, while
          only the visible rows exist in the DOM. */}
      <div style={{ height: window.totalHeight }} className="relative">
        <div style={{ transform: `translateY(${window.offsetY}px)` }}>
          {view?.ids.length
            ? Array.from({ length: view.length }, (_, i) => {
                const row = window.start + i;
                const rowId = view.ids[i]!;
                return (
                  <div
                    key={rowId}
                    role="row"
                    data-row={row}
                    className={cn(
                      "grid border-b border-border/40 text-sm tabular",
                      selected && row >= selected.from && row <= selected.to && "bg-accent"
                    )}
                    style={{ gridTemplateColumns: TEMPLATE, height: ROW_HEIGHT }}
                    onMouseDown={(event) => select(row, event.shiftKey)}
                  >
                    {COLUMNS.map((column, col) => {
                      const value = view.get(i, column.key);
                      const format = "format" in column ? column.format : undefined;
                      const isCursor = cursor.row === row && cursor.col === col;
                      return (
                        <Cell
                          key={column.key}
                          align={column.align}
                          active={isCursor}
                          editing={isCursor && editing}
                          value={value}
                          display={
                            format ? (format as (v: unknown) => string)(value) : String(value)
                          }
                          onActivate={() => {
                            setCursor({ row, col });
                            setEditing(true);
                          }}
                          onCommit={(next) => {
                            setEditing(false);
                            // Measured by the caller, so the status bar can
                            // show what the engine cost rather than what
                            // React did afterwards.
                            onEdit(() => table.setCell(rowId, column.key, next as never));
                          }}
                          onCancel={() => setEditing(false)}
                        />
                      );
                    })}
                  </div>
                );
              })
            : null}
        </div>
      </div>
    </div>
  );
}

interface CellProps {
  align: "left" | "right";
  active: boolean;
  editing: boolean;
  value: string | number;
  display: string;
  onActivate: () => void;
  onCommit: (value: string | number) => void;
  onCancel: () => void;
}

function Cell({
  align,
  active,
  editing,
  value,
  display,
  onActivate,
  onCommit,
  onCancel,
}: CellProps) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  if (editing) {
    const numeric = typeof value === "number";
    return (
      <input
        ref={input}
        type={numeric ? "number" : "text"}
        step="any"
        defaultValue={String(value)}
        data-testid="cell-editor"
        className={cn(
          "w-full bg-background px-3 text-sm outline-none ring-2 ring-ring",
          align === "right" && "text-right"
        )}
        onBlur={(event) => commit(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit(event.currentTarget.value);
          if (event.key === "Escape") onCancel();
        }}
      />
    );

    function commit(next: string) {
      const parsed = typeof value === "number" ? Number(next) : next;
      if (typeof parsed === "number" && Number.isNaN(parsed)) onCancel();
      else onCommit(parsed);
    }
  }

  return (
    <div
      role="gridcell"
      className={cn(
        "truncate px-3 leading-8",
        align === "right" && "text-right",
        active && "ring-2 ring-inset ring-ring"
      )}
      onDoubleClick={onActivate}
    >
      {display}
    </div>
  );
}
