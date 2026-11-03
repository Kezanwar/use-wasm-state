import type { ReactNode } from "react";
import { HighlightedCode } from "@/components/CodeBlock";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { API } from "@/lib/api";

/**
 * The public surface, hand-written rather than generated: the useful part
 * of an API page is the sentence saying when to reach for each thing, and
 * a generator cannot write that.
 *
 * The names live in @/lib/api so a test can hold this page against the
 * package's own exports.
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

export function ApiPage() {
  return (
    <div className="space-y-6">
      <Group title="Hooks">
        <Entry name="useWasmTable" kind="hook" signature={API.useWasmTable}>
          <p>Loads an engine, creates one table in it, and disposes both on unmount.</p>
          <Fields
            rows={[
              [
                "wasmUrl",
                "Where to fetch engine.wasm from. Defaults to the copy beside the bundle.",
              ],
              ["initialRows", "Rows inserted once, as soon as the table exists."],
              ["shared", "Share one table by key. Not implemented yet."],
              ["mode", '"sync" on the main thread, or "worker" off it.'],
              ["workerUrl", "Where to fetch the worker bundle from, in worker mode."],
            ]}
          />
          <p>
            The result is a discriminated union. <code>status</code> narrows before destructuring,{" "}
            <code>isReady</code> after it.
          </p>
        </Entry>

        <Separator />

        <Entry name="useTableView" kind="hook" signature={API.useTableView}>
          <p>
            One window of a table, or <code>null</code> while it loads. Re-renders when the revision
            moves, and reads only the rows in the window.
          </p>
        </Entry>

        <Separator />

        <Entry name="useTableStats" kind="hook" signature={API.useTableStats}>
          <p>
            Size and revision without reading any rows, for a header or a status bar.{" "}
            <code>null</code> while the table loads.
          </p>
        </Entry>

        <Separator />

        <Entry name="useTableQuery" kind="hook" signature={API.useTableQuery}>
          <p>
            The current sort, filters and search, for a toolbar that has to show which column is
            sorted and what is filtered. <code>null</code> while the table loads.
          </p>
        </Entry>
      </Group>

      <Group title="Query">
        <Entry name="TableQuery" kind="type" signature={API.TableQuery}>
          <p>
            A table has one query, and the row order is what it produces. It persists: every later
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

        <Entry name="FilterClause" kind="type" signature={API.FilterClause}>
          <p>
            Distributed over the columns, so the value is typed by the column it names and an
            operator a column cannot answer is a type error rather than a runtime one.
          </p>
        </Entry>

        <Separator />

        <Entry name="NumericOp" kind="type" signature={API.NumericOp}>
          <p>
            Plus <code>between</code>, which takes a pair of bounds.
          </p>
        </Entry>

        <Separator />

        <Entry name="StringOp" kind="type" signature={API.StringOp}>
          <p>
            Plus <code>in</code>, which takes a list. <code>contains</code> is case-insensitive.
          </p>
        </Entry>

        <Separator />

        <Entry name="SortSpec" kind="type" signature={API.SortSpec}>
          <p>One column of a multi-column sort.</p>
        </Entry>

        <Separator />

        <Entry name="SortDirection" kind="type" signature={API.SortDirection}>
          <p>Default is ascending.</p>
        </Entry>
      </Group>

      <Group title="Schema">
        <Entry name="defineSchema" kind="function" signature={API.defineSchema}>
          <p>
            Declares a table's columns. Key order is column order, and the literal kinds are what
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

        <Entry name="Row" kind="type" signature={API.Row}>
          <p>One row as an object, inferred from the schema.</p>
        </Entry>

        <Separator />

        <Entry name="TableSchema" kind="type" signature={API.TableSchema}>
          <p>
            What <code>defineSchema</code> returns. <code>names</code> and <code>kinds</code> are
            parallel and in column order.
          </p>
        </Entry>

        <Separator />

        <Entry name="SchemaSpec" kind="type" signature={API.SchemaSpec}>
          <p>
            The object passed to <code>defineSchema</code>: column name to column kind.
          </p>
        </Entry>

        <Separator />

        <Entry name="ColumnKind" kind="type" signature={API.ColumnKind}>
          <p>What a column can hold.</p>
        </Entry>

        <Separator />

        <Entry name="ValueOf" kind="type" signature={API.ValueOf}>
          <p>The JS type one column kind produces.</p>
        </Entry>

        <Separator />

        <Entry name="ColumnArray" kind="type" signature={API.ColumnArray}>
          <p>One column's rows, in the form insertColumns takes.</p>
        </Entry>

        <Separator />

        <Entry name="ColumnsInput" kind="type" signature={API.ColumnsInput}>
          <p>
            Every column as its own array. A <code>Float64Array</code> or <code>Int32Array</code> is
            the fast path: it goes into the engine with no per-row work.
          </p>
        </Entry>
      </Group>

      <Group title="Store">
        <Entry name="TableReader" kind="type" signature={API.TableReader}>
          <p>
            What both store types share: every read, and all of them synchronous, because React
            reads during render and cannot await. <code>useTableView</code>,{" "}
            <code>useTableStats</code> and <code>useTableQuery</code> take this, so a component does
            not care which mode it was handed.
          </p>
          <Fields
            rows={[
              ["version", "The subscription token. Moves whenever any read could now differ."],
              ["lastCallMs", "What the last engine call cost. The round trip in worker mode."],
              ["view", "Best-effort. In worker mode, the nearest rows it has rather than nothing."],
              ["readWindow", "The real rows, waited for. What an edit over off-screen rows needs."],
              [
                "watch",
                "Say a window is on screen. In worker mode that is what makes every reply carry its rows.",
              ],
            ]}
          />
        </Entry>

        <Separator />

        <Entry name="TableStore" kind="type" signature={API.TableStore}>
          <p>One table. Framework-agnostic, and what the hooks hand back.</p>
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
              ["query", "The query as it was last set."],
              ["view", "Read a window. Same object for the same revision and window."],
              ["subscribe", "Called after any mutation that moved the revision."],
              ["dispose", "Drop the table. Later calls throw."],
            ]}
          />
        </Entry>

        <Separator />

        <Entry name="TableView" kind="type" signature={API.TableView}>
          <p>
            One window. Columnar inside; <code>row()</code> and <code>rows()</code> build objects
            only when something needs them. <code>start</code> is where the window actually begins
            after clamping, which is not always what was asked for.
          </p>
        </Entry>

        <Separator />

        <Entry name="RowIds" kind="type" signature={API.RowIds}>
          <p>
            The ids an insert produced. Always a contiguous run, so it is described rather than
            materialised: an array of 200,000 numbers is 1.6 MB almost every caller throws away.
          </p>
        </Entry>

        <Separator />

        <Entry name="TableStats" kind="type" signature={API.TableStats}>
          <p>
            What <code>useTableStats</code> returns.
          </p>
        </Entry>

        <Separator />

        <Entry name="AsyncTableStore" kind="type" signature={API.AsyncTableStore}>
          <p>
            What worker mode hands back. The reads are the same and still synchronous; the mutations
            return Promises, because they really do cross a thread. The worker sends rows for every
            window on screen with each reply, so one round trip covers a whole user action.
          </p>
        </Entry>
      </Group>

      <Group title="Engine">
        <Entry name="createEngine" kind="function" signature={API.createEngine}>
          <p>
            One wasm instance holding any number of tables, for use outside React. One instance is
            one linear memory, which is why tables that share data have to share an engine.
          </p>
        </Entry>

        <Separator />

        <Entry name="Engine" kind="type" signature={API.Engine}>
          <p>
            <code>dispose()</code> drops every table made from it.
          </p>
        </Entry>

        <Separator />

        <Entry name="EngineOptions" kind="type" signature={API.EngineOptions}>
          <p>
            <code>cache</code> reuses the compiled module across engines with the same URL.{" "}
            <code>workerUrl</code> is for a CSP that names an explicit <code>worker-src</code>.
          </p>
        </Entry>

        <Separator />

        <Entry name="Mode" kind="type" signature={API.Mode}>
          <p>
            <code>sync</code> runs the engine on the main thread; <code>worker</code> moves it off,
            which makes mutations async and a long sort something the page can scroll through.
          </p>
        </Entry>

        <Separator />

        <Entry name="StoreFor" kind="type" signature={API.StoreFor}>
          <p>Which store a mode produces, so the option types the result.</p>
        </Entry>
      </Group>

      <Group title="Errors">
        <Entry name="WasmStateError" kind="class" signature={API.WasmStateError}>
          <p>
            Everything this package throws. The engine returns small negative integers rather than
            trapping, and this turns the ones you should not ignore into something with a name and a
            stack.
          </p>
        </Entry>

        <Separator />

        <Entry name="WasmStateErrorCode" kind="type" signature={API.WasmStateErrorCode}>
          <p>Stable names, for switching on a failure.</p>
        </Entry>
      </Group>

      <Group title="Hook results">
        <Entry name="UseWasmTableResult" kind="type" signature={API.UseWasmTableResult}>
          <p>
            <code>isReady</code> carries a literal type per branch, so it narrows after
            destructuring where <code>status</code> no longer can.
          </p>
        </Entry>

        <Separator />

        <Entry name="UseWasmTableOptions" kind="type" signature={API.UseWasmTableOptions}>
          <p>
            Read once, on mount. A table holding rows cannot be migrated, so changing the schema
            afterwards is ignored.
          </p>
        </Entry>
      </Group>
    </div>
  );
}
