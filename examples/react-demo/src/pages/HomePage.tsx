import { useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { ArrowRight } from "lucide-react";
import { CodeBlock } from "@/components/CodeBlock";
import { Section } from "@/components/Section";
import { Go, Js, Wasm } from "@/components/Term";
import { PUBLISHED } from "@/bench/figures";
import { formatMs } from "@/bench/format";
import { DOCUMENTED } from "@/lib/api";

/** Where the old single-page tabs went. */
const OLD_TABS: Record<string, string> = {
  start: "/datagrid/start",
  examples: "/datagrid/examples",
  benchmarks: "/datagrid/benchmarks",
  api: "/datagrid/api",
};

/** Core's anchors, from when Core was this page. Checked against Core by the drift test. */
export const CORE_ANCHORS = new Set([...DOCUMENTED.root, "use-wasm-state", "providers", "errors"]);

const FIRST_USE = `npm install use-wasm-state

import { defineSchema, useDataGridView, useWasmDataGridSync } from "use-wasm-state/datagrid";

const schema = defineSchema({ item: "string", qty: "i32", price: "f64" });

function Items() {
  const { grid } = useWasmDataGridSync(schema, {
    initialRows: [{ item: "Keyboard", qty: 2, price: 89 }],
  });
  const view = useDataGridView(grid, 0, 50);
  return view?.rows().map((row, i) => <p key={view.ids[i]}>{row.item}</p>);
}`;

const sort = PUBLISHED.operations.find((op) => op.id === "sort-f64")!.results;

export function HomePage() {
  const { hash } = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    const id = hash.slice(1);
    if (OLD_TABS[id]) navigate(OLD_TABS[id], { replace: true });
    else if (CORE_ANCHORS.has(id)) navigate(`/core#${id}`, { replace: true });
  }, [hash, navigate]);

  return (
    <div className="space-y-6">
      <p className="text-lg">
        React state for data that is too big or too busy for <code>useState</code>. The data and the
        work on it live in a <Go /> engine compiled to <Wasm>WebAssembly</Wasm>, and React shows the
        result.
      </p>

      <Section title="The idea">
        <ul className="text-muted-foreground list-disc space-y-1.5 pl-5 text-sm">
          <li>
            Some state is too big or changes too often to keep in <code>useState</code>: hundreds of
            thousands of rows, sorted, filtered and edited while you scroll.
          </li>
          <li>
            Here the data and the heavy work, sorting, filtering, searching, live in a <Go /> engine
            compiled to <Wasm>WebAssembly</Wasm>.
          </li>
          <li>React keeps only UI state: the scroll position, the selection, what is open.</li>
          <li>
            Only the rows on screen cross into <Js />, so a 200,000-row grid costs about fifty rows
            of work per frame.
          </li>
          <li>
            The engine runs on the main thread, or in a worker so the page keeps painting while it
            works.
          </li>
        </ul>
      </Section>

      <Section title="The ethos">
        <ul className="text-muted-foreground list-disc space-y-1.5 pl-5 text-sm">
          <li>
            Specialised state patterns, not generic state. Each one ships its own engine built for
            one job, because wasm only pays off when the work runs there too.
          </li>
          <li>
            Honest benchmarks, measured against plain and hand-optimised <Js />, including where
            plain <Js /> wins.
          </li>
          <li>Small, typed APIs: a hook to create the state, hooks to read it.</li>
        </ul>
      </Section>

      <Section title="State patterns">
        <Link
          to="/datagrid"
          className="hover:bg-accent flex items-center justify-between gap-4 rounded-md border p-3 transition-colors"
        >
          <span className="text-sm">
            <span className="font-medium">DataGrid</span>
            <span className="text-muted-foreground">
              : a table of rows you can sort, filter, search and edit at 200,000 rows and beyond.
            </span>
          </span>
          <ArrowRight className="size-4 shrink-0" />
        </Link>
        <p className="text-muted-foreground text-sm">More patterns are planned.</p>
      </Section>

      <Section title="Install and first use">
        <CodeBlock code={FIRST_USE} label="tsx" />
      </Section>

      <Section title="One result">
        <p className="text-muted-foreground text-sm" data-testid="home-result">
          Sorting {PUBLISHED.rows.toLocaleString("en-US")} rows by price takes{" "}
          <span className="text-foreground font-medium">{formatMs(sort.typical.median)}</span> in
          typical <Js /> and{" "}
          <span className="text-foreground font-medium">{formatMs(sort.wasm.median)}</span> in{" "}
          <Wasm>wasm</Wasm>.{" "}
          <Link to="/datagrid/benchmarks" className="text-foreground underline underline-offset-2">
            Every figure, and where JS wins
          </Link>
          .
        </p>
      </Section>
    </div>
  );
}
