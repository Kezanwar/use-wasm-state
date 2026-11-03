import type { ReactNode } from "react";
import { Go, Js, Name, Wasm } from "@/components/Term";
import { CodeBlock } from "@/components/CodeBlock";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const INSTALL = `npm install use-wasm-state`;

const QUICK = `import { defineSchema, useWasmTable, useTableView } from "use-wasm-state";

const schema = defineSchema({ item: "string", qty: "i32", price: "f64" });

export function Basket() {
  const { status, table } = useWasmTable(schema, {
    initialRows: [{ item: "Keyboard", qty: 2, price: 89 }],
  });
  const view = useTableView(table, 0, 50);

  if (status !== "ready") return null;

  return (
    <>
      <button onClick={() => table.insertRows([{ item: "Cable", qty: 8, price: 4.25 }])}>
        Add
      </button>
      <ul>
        {view?.rows().map((row, i) => (
          <li key={view.ids[i]}>
            {row.item} x{row.qty} - {row.price}
          </li>
        ))}
      </ul>
    </>
  );
}`;

const VIEWPORT = `// 200,000 rows live in Go. Fifty cross to JS.
const view = useTableView(table, Math.floor(scrollTop / 32), 50);

// An edit is one call and one revision bump.
table.setCell(rowId, "price", 12.5);`;

const SERVING = `// Default: resolved next to the bundle, streaming compile kept.
useWasmTable(schema);

// Override for a CDN, a strict CSP, or a bundler that
// cannot resolve the asset.
useWasmTable(schema, { wasmUrl: "https://cdn.example.com/engine.wasm" });`;

const WORKER = `const { status, table } = useWasmTable(schema, { mode: "worker" });

// Reads are the same, and still synchronous.
const view = useTableView(table, start, 50);

// Mutations cross a thread, so they return Promises.
await table.setCell(rowId, "price", 12.5);
await table.sortBy("price", "desc");`;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export function GettingStartedPage() {
  return (
    <div className="space-y-6">
      <Section title="Install">
        <CodeBlock code={INSTALL} label="bash" language="bash" />
      </Section>

      <Section title="A table in twenty lines">
        <CodeBlock code={QUICK} label="tsx" />
      </Section>

      <Section title="Why the state lives in Go">
        <p className="text-muted-foreground text-sm">
          Storing arbitrary <Js /> values in <Wasm>wasm</Wasm> means serialising on every read,
          which is slower than <code>useState</code>. It only pays off when the operations on the
          state run in <Wasm>wasm</Wasm> too. So <Go /> owns the rows, the string dictionaries and
          the row order; React owns the scroll position and the selection. A counter on the table
          bumps on every mutation, <code>useSyncExternalStore</code> watches that counter, and each
          component reads back only the rows it is showing.
        </p>
        <CodeBlock code={VIEWPORT} label="tsx" />
      </Section>

      <Section title="Sync mode">
        <p className="text-muted-foreground text-sm">
          The engine runs on the main thread, so a viewport is read during render and a mutation is
          visible on the next line. That is the only mode today. Worker mode will move the engine
          off the main thread behind the same API; until it lands, <code>mode: "worker"</code>{" "}
          reports a <code>not_implemented</code> error through <code>status</code> rather than
          failing quietly.
        </p>
      </Section>

      <Section title="Worker mode">
        <p className="text-muted-foreground text-sm">
          The engine moves off the main thread. Reads stay synchronous, because the worker sends
          rows for every window on screen with each reply, so one round trip covers a whole user
          action. Mutations return Promises, because they really do cross a thread. The option types
          the result, and both stores satisfy <code>TableReader</code>, so a component that only
          reads does not care which it was handed.
        </p>
        <CodeBlock code={WORKER} label="tsx" />
      </Section>

      <Section title="Serving engine.wasm">
        <p className="text-muted-foreground text-sm">
          The engine is a 38 kB module that imports nothing. It is resolved with{" "}
          <code>new URL("./engine.wasm", import.meta.url)</code>, which <Name>Vite</Name> and{" "}
          <Name>webpack 5</Name> both understand. The <Name>CJS</Name> build ships a shim for{" "}
          <code>import.meta.url</code>; if a bundler still cannot resolve the asset, pass{" "}
          <code>wasmUrl</code>.
        </p>
        <CodeBlock code={SERVING} label="tsx" />
      </Section>
    </div>
  );
}
