import { defineSchema, useTableStats, useTableView, useWasmTable } from "use-wasm-state";
import type { TableStore } from "use-wasm-state";

const schema = defineSchema({ n: "i32", label: "string" });

const ROWS = Array.from({ length: 40 }, (_, i) => ({
  n: i,
  label: `row ${i}`,
}));

/**
 * One table, two windows. Both read through useTableView, so an edit in
 * either is a single revision bump that both of them see.
 */
export function TwoViewsExample() {
  const { status, table } = useWasmTable(schema, { initialRows: ROWS });
  const stats = useTableStats(table);

  if (status !== "ready") return <div className="bg-muted/40 h-40 animate-pulse rounded-md" />;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <Window table={table} start={0} testId="window-top" />
        <Window table={table} start={20} testId="window-bottom" />
      </div>
      <p className="text-muted-foreground font-mono text-xs" data-testid="two-views-stats">
        r{stats?.revision} · {stats?.rowCount} rows
      </p>
    </div>
  );
}

function Window({
  table,
  start,
  testId,
}: {
  table: TableStore<typeof schema.spec>;
  start: number;
  testId: string;
}) {
  const view = useTableView(table, start, 5);
  if (!view) return null;

  return (
    <div className="rounded-md border p-2" data-testid={testId}>
      <p className="text-muted-foreground mb-1 font-mono text-[11px]">
        view({view.start}, {view.length})
      </p>
      <ul className="space-y-0.5 text-sm">
        {view.rows().map((row, i) => (
          <li key={view.ids[i]} className="flex items-center gap-2">
            <input
              className="min-w-0 flex-1 bg-transparent outline-none"
              value={row.label}
              onChange={(e) => table.setCell(view.ids[i]!, "label", e.target.value)}
            />
            <span className="text-muted-foreground tabular text-xs">{row.n}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
