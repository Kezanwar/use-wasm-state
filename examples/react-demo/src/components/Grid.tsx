import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp } from "lucide-react";
import { cn } from "cn";
import {
  useDataGridQuery,
  useDataGridView,
  type AnyDataGridStore,
  type SortDirection,
} from "use-wasm-state/datagrid";
import { useVirtualWindow } from "@/hooks/useVirtualWindow";
import { formatDate, formatPrice } from "@/lib/format";
import type { Order, orders } from "@/lib/orders";

type Schema = typeof orders.spec;

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
  grid: AnyDataGridStore<Schema>;
  /** Worker mode fetches a window a round trip later, so it reads ahead. */
  overscan?: number;
  rowCount: number;
  selection: Selection | null;
  onSelectionChange: (selection: Selection | null) => void;
  /** Runs an edit, so the caller can time it. */
  onEdit: (run: () => unknown) => void;
  /** Sorting changes the query, which the caller treats differently. */
  onSort: (run: () => unknown) => void;
}

export function Grid({
  grid,
  rowCount,
  overscan,
  selection,
  onSelectionChange,
  onEdit,
  onSort,
}: GridProps) {
  const window = useVirtualWindow(rowCount, ROW_HEIGHT, overscan);
  const view = useDataGridView(grid, window.start, window.count);
  const query = useDataGridQuery(grid);

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

  /**
   * Stable callbacks, so a memoised row keeps its memo.
   *
   * Each one takes the row it acts on as an argument rather than closing
   * over it, and reads mutable state through a ref. A handler rebuilt per
   * row per render would make every row's props new every time, and the
   * memoisation above would buy nothing.
   */
  const latest = useRef({ grid, selection, onEdit, onSelectionChange });
  latest.current = { grid, selection, onEdit, onSelectionChange };

  const select = useCallback((offset: number, extend: boolean) => {
    const { selection: current, onSelectionChange: change } = latest.current;
    change(
      extend && current
        ? { anchor: current.anchor, focus: offset }
        : { anchor: offset, focus: offset }
    );
    setCursor((c) => ({ ...c, row: offset }));
  }, []);

  const activate = useCallback((offset: number, col: number) => {
    setCursor({ row: offset, col });
    setEditing(true);
  }, []);

  const commit = useCallback((rowId: number, col: number, value: string | number) => {
    setEditing(false);
    const { grid: store, onEdit: measure } = latest.current;
    // Measured by the caller, so the status bar shows what the engine
    // cost rather than what React did afterwards.
    measure(() => store.setCell(rowId, COLUMNS[col]!.key, value as never));
  }, []);

  const cancel = useCallback(() => setEditing(false), []);

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
        {COLUMNS.map((column) => {
          const at = query?.sort.findIndex((key) => key.column === column.key) ?? -1;
          const sort = at === -1 ? undefined : query!.sort[at];
          return (
            <button
              key={column.key}
              type="button"
              data-testid={`sort-${column.key}`}
              aria-sort={sort ? (sort.direction === "desc" ? "descending" : "ascending") : "none"}
              onClick={(event) => onSort(() => cycleSort(grid, column.key, event.shiftKey))}
              className={cn(
                "hover:text-foreground flex items-center gap-1 truncate px-3 leading-8 transition-colors",
                column.align === "right" && "justify-end",
                sort && "text-foreground"
              )}
            >
              {column.label}
              {sort &&
                (sort.direction === "desc" ? (
                  <ArrowDown className="size-3" />
                ) : (
                  <ArrowUp className="size-3" />
                ))}
              {/* Only worth showing once a second key exists. */}
              {sort && (query?.sort.length ?? 0) > 1 && (
                <span className="tabular text-[10px]">{at + 1}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Sized to the whole grid so the scrollbar tells the truth, while
          only the visible rows exist in the DOM. */}
      <div style={{ height: window.totalHeight }} className="relative">
        {/* Positioned from the view's own start, not the window we asked
            for. In worker mode the rows may be a round trip behind, and
            drawing them where they actually belong beats blanking. */}
        <div style={{ transform: `translateY(${(view?.start ?? window.start) * ROW_HEIGHT}px)` }}>
          {view?.ids.length
            ? Array.from({ length: view.length }, (_, i) => {
                const offset = view.start + i;
                const rowId = view.ids[i]!;
                return (
                  <Row
                    key={i}
                    offset={offset}
                    rowId={rowId}
                    values={COLUMNS.map((column) => view.get(i, column.key))}
                    selected={selected !== null && offset >= selected.from && offset <= selected.to}
                    cursorCol={cursor.row === offset ? cursor.col : -1}
                    editing={cursor.row === offset && editing}
                    onSelect={select}
                    onActivate={activate}
                    onCommit={commit}
                    onCancel={cancel}
                  />
                );
              })
            : null}
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  /** Offset into the live order, which is what selection and the cursor use. */
  offset: number;
  rowId: number;
  values: readonly (string | number)[];
  selected: boolean;
  /** The column the cursor is on, or -1 when it is on another row. */
  cursorCol: number;
  editing: boolean;
  onSelect: (offset: number, extend: boolean) => void;
  onActivate: (offset: number, col: number) => void;
  onCommit: (rowId: number, col: number, value: string | number) => void;
  onCancel: () => void;
}

/**
 * One row, memoised on its values.
 *
 * Every prop is a primitive or a stable callback, so a render of the grid
 * only reaches the rows whose data actually changed. `values` is a fresh
 * array each time, which is why the comparison below walks it: comparing
 * the arrays by identity would make the memo useless, and leaving the memo
 * off would re-render forty rows for a scroll of one.
 */
const Row = memo(
  function Row({
    offset,
    rowId,
    values,
    selected,
    cursorCol,
    editing,
    onSelect,
    onActivate,
    onCommit,
    onCancel,
  }: RowProps) {
    return (
      <div
        role="row"
        data-row={offset}
        data-id={rowId}
        className={cn("grid border-b border-border/40 text-sm tabular", selected && "bg-accent")}
        style={{ gridTemplateColumns: TEMPLATE, height: ROW_HEIGHT }}
        onMouseDown={(event) => onSelect(offset, event.shiftKey)}
      >
        {COLUMNS.map((column, col) => {
          const format = "format" in column ? column.format : undefined;
          const value = values[col]!;
          return (
            <Cell
              key={column.key}
              col={col}
              align={column.align}
              active={cursorCol === col}
              editing={editing && cursorCol === col}
              value={value}
              display={format ? (format as (v: unknown) => string)(value) : String(value)}
              rowId={rowId}
              offset={offset}
              onActivate={onActivate}
              onCommit={onCommit}
              onCancel={onCancel}
            />
          );
        })}
      </div>
    );
  },
  (a, b) =>
    a.offset === b.offset &&
    a.rowId === b.rowId &&
    a.selected === b.selected &&
    a.cursorCol === b.cursorCol &&
    a.editing === b.editing &&
    a.values.length === b.values.length &&
    a.values.every((value, i) => value === b.values[i])
);

interface CellProps {
  col: number;
  align: "left" | "right";
  active: boolean;
  editing: boolean;
  value: string | number;
  display: string;
  rowId: number;
  offset: number;
  onActivate: (offset: number, col: number) => void;
  onCommit: (rowId: number, col: number, value: string | number) => void;
  onCancel: () => void;
}

/** Memoised for the same reason as Row: a cursor move touches two cells. */
const Cell = memo(function Cell({
  col,
  align,
  active,
  editing,
  value,
  display,
  rowId,
  offset,
  onActivate,
  onCommit,
  onCancel,
}: CellProps) {
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  if (editing) {
    const commit = (next: string) => {
      const parsed = typeof value === "number" ? Number(next) : next;
      if (typeof parsed === "number" && Number.isNaN(parsed)) onCancel();
      else onCommit(rowId, col, parsed);
    };

    return (
      <input
        ref={input}
        type={typeof value === "number" ? "number" : "text"}
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
  }

  return (
    <div
      role="gridcell"
      className={cn(
        "truncate px-3 leading-8",
        align === "right" && "text-right",
        active && "ring-2 ring-inset ring-ring"
      )}
      onDoubleClick={() => onActivate(offset, col)}
    >
      {display}
    </div>
  );
});

/**
 * Click a header to sort: ascending, then descending, then off. Shift-click
 * adds the column to the existing sort rather than replacing it.
 *
 * Three states on one control, and the arrow says which one you are in, so
 * there is nothing to explain.
 */
function cycleSort(grid: AnyDataGridStore<Schema>, column: keyof Order, shift: boolean) {
  const sort = grid.query.sort;
  const at = sort.findIndex((key) => key.column === column);
  const current: SortDirection | undefined = at === -1 ? undefined : sort[at]!.direction;
  const next: SortDirection | undefined =
    current === undefined ? "asc" : current === "asc" ? "desc" : undefined;

  if (!shift) return grid.sortBy(column, next);

  const rest = sort.filter((key) => key.column !== column);
  return grid.setQuery({
    ...grid.query,
    sort: next ? [...rest, { column, direction: next }] : rest,
  });
}
