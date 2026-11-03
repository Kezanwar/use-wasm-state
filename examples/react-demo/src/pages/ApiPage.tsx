import type { ReactNode } from "react";
import { HighlightedCode } from "@/components/CodeBlock";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { DATAGRID_API as GRID, ROOT_API as ROOT } from "@/lib/api";

/**
 * The public surface, hand-written rather than generated: the useful part
 * of an API page is the sentence saying when to reach for each thing, and
 * a generator cannot write that.
 *
 * The names live in @/lib/api so a test can hold this page against each
 * entry point's own exports.
 */

function Entry({
  name,
  kind,
  signature,
  children,
}: {
  name: string;
  kind: "function" | "hook" | "type" | "class";
  signature: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2.5" data-api={name}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-foreground font-mono text-sm font-semibold">{name}</h3>
        <Badge variant="secondary" className="font-normal">
          {kind}
        </Badge>
      </div>
      <HighlightedCode
        code={signature}
        className="rounded-md border px-3 py-2 text-[12px] leading-relaxed"
      />
      <div className="text-muted-foreground space-y-2 text-sm">{children}</div>
    </div>
  );
}

function Fields({ rows }: { rows: [string, string][] }) {
  return (
    <table className="w-full text-sm">
      <tbody>
        {rows.map(([name, description]) => (
          <tr key={name} className="border-border/50 border-t align-top">
            <td className="text-foreground w-44 py-1.5 pr-3 font-mono text-xs">{name}</td>
            <td className="text-muted-foreground py-1.5">{description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">{children}</CardContent>
    </Card>
  );
}

/** One import path and everything that comes from it. */
function EntryPoint({ path, children }: { path: string; children: ReactNode }) {
  return (
    <section className="space-y-4" data-entry={path}>
      <h2 className="font-mono text-sm font-semibold">{path}</h2>
      {children}
    </section>
  );
}

export function ApiPage() {
  return (
    <div className="space-y-10">
      <EntryPoint path="use-wasm-state">
        <Group title="Providers">
          <Entry
            name="WasmStateSyncProvider"
            kind="function"
            signature={ROOT.WasmStateSyncProvider}
          >
            <p>
              Holds shared state on the main thread. Each kind of state gets one engine, loaded the
              first time something uses it and disposed when the provider unmounts. Each definition
              gets one instance, which outlives the components showing it.
            </p>
            <Fields rows={[["urls", "Where each engine is fetched from, by pattern name."]]} />
          </Entry>

          <Separator />

          <Entry
            name="WasmStateAsyncProvider"
            kind="function"
            signature={ROOT.WasmStateAsyncProvider}
          >
            <p>
              The same, with each engine in a worker. Both providers can be nested, and each is read
              only by the hooks of its own mode.
            </p>
            <Fields
              rows={[
                ["urls", "Where each engine and its worker are fetched from, by pattern name."],
              ]}
            />
          </Entry>

          <Separator />

          <Entry name="useWasmStateSync" kind="hook" signature={ROOT.useWasmStateSync}>
            <p>The sync provider above this component.</p>
          </Entry>

          <Separator />

          <Entry name="useWasmStateAsync" kind="hook" signature={ROOT.useWasmStateAsync}>
            <p>The async provider above this component.</p>
          </Entry>

          <Separator />

          <Entry name="WasmState" kind="type" signature={ROOT.WasmState}>
            <p>
              <code>drop</code> disposes a shared instance. Its next use creates it again from the
              definition, initial rows and all, and anything still showing it gets the new one.
            </p>
          </Entry>

          <Separator />

          <Entry name="WasmStateDef" kind="type" signature={ROOT.WasmStateDef}>
            <p>
              Any shared definition, such as a <code>DataGridDef</code>. Two different definitions
              under one key in one provider are a <code>schema_mismatch</code>, unless they describe
              the same shape.
            </p>
          </Entry>

          <Separator />

          <Entry
            name="WasmStateSyncProviderProps"
            kind="type"
            signature={ROOT.WasmStateSyncProviderProps}
          >
            <p>Read once, when the provider mounts.</p>
          </Entry>

          <Separator />

          <Entry
            name="WasmStateAsyncProviderProps"
            kind="type"
            signature={ROOT.WasmStateAsyncProviderProps}
          >
            <p>Read once, when the provider mounts.</p>
          </Entry>
        </Group>

        <Group title="Errors">
          <Entry name="WasmStateError" kind="class" signature={ROOT.WasmStateError}>
            <p>
              Everything this package throws or reports through a hook's <code>error</code>. Engines
              return small negative integers rather than trapping, and this turns the ones you
              should not ignore into something with a name and a stack.
            </p>
          </Entry>

          <Separator />

          <Entry name="WasmStateErrorCode" kind="type" signature={ROOT.WasmStateErrorCode}>
            <p>Stable names, for switching on a failure.</p>
            <Fields
              rows={[
                ["schema_mismatch", "Two different definitions share a key in one provider."],
                ["no_provider", "A definition is used with no provider of its mode above it."],
                ["disposed", "A call on a grid or engine that has gone."],
              ]}
            />
          </Entry>
        </Group>
      </EntryPoint>

      <EntryPoint path="use-wasm-state/datagrid">
        <Group title="Hooks">
          <Entry name="useWasmDataGridSync" kind="hook" signature={GRID.useWasmDataGridSync}>
            <p>
              A grid on the main thread. Given a schema, a one-off: a private engine with one grid
              in it, disposed on unmount. Given a definition, the shared grid from the{" "}
              <code>WasmStateSyncProvider</code> above.
            </p>
            <p>
              The result is a discriminated union. <code>status</code> narrows before destructuring,{" "}
              <code>isReady</code> after it.
            </p>
          </Entry>

          <Separator />

          <Entry name="useWasmDataGridAsync" kind="hook" signature={GRID.useWasmDataGridAsync}>
            <p>
              The same, in a worker, with the <code>WasmStateAsyncProvider</code> for a definition.
              Reads stay synchronous; mutations return Promises.
            </p>
          </Entry>

          <Separator />

          <Entry name="useDataGridView" kind="hook" signature={GRID.useDataGridView}>
            <p>
              One window of a grid, or <code>null</code> while it loads. Re-renders when the
              revision moves, and reads only the rows in the window.
            </p>
          </Entry>

          <Separator />

          <Entry name="useDataGridStats" kind="hook" signature={GRID.useDataGridStats}>
            <p>
              Size and revision without reading any rows, for a header or a status bar.{" "}
              <code>null</code> while the grid loads.
            </p>
          </Entry>

          <Separator />

          <Entry name="useDataGridQuery" kind="hook" signature={GRID.useDataGridQuery}>
            <p>
              The current sort, filters and search, for a toolbar. <code>null</code> while the grid
              loads.
            </p>
          </Entry>
        </Group>

        <Group title="Sharing">
          <Entry name="defineDataGrid" kind="function" signature={GRID.defineDataGrid}>
            <p>
              Names a grid and fixes its shape, at module scope. Does nothing on its own: no engine,
              no wasm, safe on a server. The grid is made by the first hook that uses it.
            </p>
          </Entry>

          <Separator />

          <Entry name="DataGridDef" kind="type" signature={GRID.DataGridDef}>
            <p>
              What <code>defineDataGrid</code> returns, and what the creation hooks and{" "}
              <code>drop</code> take.
            </p>
          </Entry>

          <Separator />

          <Entry name="DataGridDefOptions" kind="type" signature={GRID.DataGridDefOptions}>
            <p>Inserted when the grid is created, and again after a drop.</p>
          </Entry>
        </Group>

        <Group title="Query">
          <Entry name="DataGridQuery" kind="type" signature={GRID.DataGridQuery}>
            <p>
              A grid has one query, and the row order is what it produces. It persists: every later
              mutation re-applies it, so an inserted row lands where the sort says and an edited one
              leaves a filter it no longer matches.
            </p>
            <Fields
              rows={[
                ["sort", "Columns in priority order. Stable, ties broken by row id."],
                ["filters", "Clauses, combined with AND."],
                ["search", "Case-insensitive substring across every string column."],
              ]}
            />
          </Entry>

          <Separator />

          <Entry name="FilterClause" kind="type" signature={GRID.FilterClause}>
            <p>
              Distributed over the columns, so the value is typed by the column it names and an
              operator a column cannot answer is a type error rather than a runtime one.
            </p>
          </Entry>

          <Separator />

          <Entry name="NumericOp" kind="type" signature={GRID.NumericOp}>
            <p>
              Plus <code>between</code>, which takes a pair of bounds.
            </p>
          </Entry>

          <Separator />

          <Entry name="StringOp" kind="type" signature={GRID.StringOp}>
            <p>
              Plus <code>in</code>, which takes a list. <code>contains</code> is case-insensitive.
            </p>
          </Entry>

          <Separator />

          <Entry name="SortSpec" kind="type" signature={GRID.SortSpec}>
            <p>One column of a multi-column sort.</p>
          </Entry>

          <Separator />

          <Entry name="SortDirection" kind="type" signature={GRID.SortDirection}>
            <p>Default is ascending.</p>
          </Entry>
        </Group>

        <Group title="Schema">
          <Entry name="defineSchema" kind="function" signature={GRID.defineSchema}>
            <p>
              Declares a grid's columns. Key order is column order, and the literal kinds are what
              make <code>Row</code>, <code>setCell</code> and <code>view.get</code> typed.
            </p>
            <Fields
              rows={[
                ["i32", "32-bit integer."],
                ["f64", "64-bit float."],
                ["string", "Dictionary-encoded; cells hold int32 ids."],
              ]}
            />
          </Entry>

          <Separator />

          <Entry name="Row" kind="type" signature={GRID.Row}>
            <p>One row as an object, inferred from the schema.</p>
          </Entry>

          <Separator />

          <Entry name="DataGridSchema" kind="type" signature={GRID.DataGridSchema}>
            <p>
              What <code>defineSchema</code> returns. <code>names</code> and <code>kinds</code> are
              parallel and in column order.
            </p>
          </Entry>

          <Separator />

          <Entry name="SchemaSpec" kind="type" signature={GRID.SchemaSpec}>
            <p>
              The object passed to <code>defineSchema</code>: column name to column kind.
            </p>
          </Entry>

          <Separator />

          <Entry name="ColumnKind" kind="type" signature={GRID.ColumnKind}>
            <p>What a column can hold.</p>
          </Entry>

          <Separator />

          <Entry name="ValueOf" kind="type" signature={GRID.ValueOf}>
            <p>The JS type one column kind produces.</p>
          </Entry>

          <Separator />

          <Entry name="ColumnArray" kind="type" signature={GRID.ColumnArray}>
            <p>One column's rows, in the form insertColumns takes.</p>
          </Entry>

          <Separator />

          <Entry name="ColumnsInput" kind="type" signature={GRID.ColumnsInput}>
            <p>
              Every column as its own array. A <code>Float64Array</code> or <code>Int32Array</code>{" "}
              is the fast path: it goes into the engine with no per-row work.
            </p>
          </Entry>
        </Group>

        <Group title="Store">
          <Entry name="DataGridReader" kind="type" signature={GRID.DataGridReader}>
            <p>
              What both stores share: every read, and all of them synchronous, because React reads
              during render and cannot await. The read hooks take this, so a component that only
              reads does not care which mode it was handed.
            </p>
            <Fields
              rows={[
                ["version", "The subscription token. Moves whenever any read could now differ."],
                ["lastCallMs", "What the last engine call cost. The round trip in a worker."],
                ["view", "Best-effort. In a worker, the nearest rows it has rather than nothing."],
                [
                  "readWindow",
                  "The real rows, waited for. What an edit over off-screen rows needs.",
                ],
                [
                  "watch",
                  "Say a window is on screen. In a worker that is what makes every reply carry its rows.",
                ],
              ]}
            />
          </Entry>

          <Separator />

          <Entry name="DataGridStore" kind="type" signature={GRID.DataGridStore}>
            <p>A grid on the main thread. Mutations are visible on the next line.</p>
            <Fields
              rows={[
                ["insertRows", "Append rows given as objects."],
                ["insertColumns", "Append rows given as one array per column."],
                ["setCell", "Write one cell, by row id and column name."],
                ["deleteRows", "Tombstone rows. Surviving ids do not move."],
                ["setQuery", "Replace the sort, filters and search. Parts left out are cleared."],
                ["sortBy", "Replace the sort with one column. No direction clears it."],
                ["filter", "Replace the filters, keeping the sort and the search."],
                ["search", "Replace the search text, keeping the rest."],
                ["clearQuery", "Back to live rows in id order."],
                ["dispose", "Drop the grid. Later calls throw."],
              ]}
            />
          </Entry>

          <Separator />

          <Entry name="AsyncDataGridStore" kind="type" signature={GRID.AsyncDataGridStore}>
            <p>
              A grid in a worker. The reads are the same and still synchronous; the mutations return
              Promises, because they really do cross a thread. The worker sends rows for every
              window on screen with each reply, so one round trip covers a whole user action.
            </p>
          </Entry>

          <Separator />

          <Entry name="AnyDataGridStore" kind="type" signature={GRID.AnyDataGridStore}>
            <p>
              Either store. A component that awaits every mutation it makes runs under both modes
              unchanged; on a sync store the <code>await</code> costs a microtask and nothing else.
            </p>
          </Entry>

          <Separator />

          <Entry name="DataGridView" kind="type" signature={GRID.DataGridView}>
            <p>
              One window. Columnar inside; <code>row()</code> and <code>rows()</code> build objects
              only when something needs them. <code>start</code> is where the window actually begins
              after clamping, which is not always what was asked for.
            </p>
          </Entry>

          <Separator />

          <Entry name="RowIds" kind="type" signature={GRID.RowIds}>
            <p>
              The ids an insert produced. Always a contiguous run, so it is described rather than
              materialised: an array of 200,000 numbers is 1.6 MB almost every caller throws away.
            </p>
          </Entry>

          <Separator />

          <Entry name="DataGridStats" kind="type" signature={GRID.DataGridStats}>
            <p>
              What <code>useDataGridStats</code> returns.
            </p>
          </Entry>
        </Group>

        <Group title="Hook results">
          <Entry name="UseWasmDataGridResult" kind="type" signature={GRID.UseWasmDataGridResult}>
            <p>
              <code>isReady</code> carries a literal type per branch, so it narrows after
              destructuring where <code>status</code> no longer can.
            </p>
          </Entry>

          <Separator />

          <Entry
            name="UseWasmDataGridSyncOptions"
            kind="type"
            signature={GRID.UseWasmDataGridSyncOptions}
          >
            <p>
              For a one-off, read once on mount. A grid holding rows cannot be migrated, so changing
              the schema afterwards is ignored.
            </p>
          </Entry>

          <Separator />

          <Entry
            name="UseWasmDataGridAsyncOptions"
            kind="type"
            signature={GRID.UseWasmDataGridAsyncOptions}
          >
            <p>
              Plus <code>workerUrl</code>, for a CSP that names an explicit <code>worker-src</code>.
            </p>
          </Entry>
        </Group>
      </EntryPoint>
    </div>
  );
}
