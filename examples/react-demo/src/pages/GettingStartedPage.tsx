import type { ReactNode } from "react";
import { Go, Js, Name, Wasm } from "@/components/Term";
import { CodeBlock } from "@/components/CodeBlock";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const INSTALL = `npm install use-wasm-state`;

const QUICK = `import { defineSchema, useDataGridView, useWasmDataGridSync } from "use-wasm-state/datagrid";

const schema = defineSchema({ item: "string", qty: "i32", price: "f64" });

export function Basket() {
  const { status, grid } = useWasmDataGridSync(schema, {
    initialRows: [{ item: "Keyboard", qty: 2, price: 89 }],
  });
  const view = useDataGridView(grid, 0, 50);

  if (status !== "ready") return null;

  return (
    <>
      <button onClick={() => grid.insertRows([{ item: "Cable", qty: 8, price: 4.25 }])}>
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
const view = useDataGridView(grid, Math.floor(scrollTop / 32), 50);

// An edit is one call and one revision bump.
grid.setCell(rowId, "price", 12.5);`;

const WORKER = `const { status, grid } = useWasmDataGridAsync(schema);

// Reads are the same, and still synchronous.
const view = useDataGridView(grid, start, 50);

// Mutations cross a thread, so they return Promises.
await grid.setCell(rowId, "price", 12.5);
await grid.sortBy("price", "desc");`;

const PORTABLE = `// Awaits every mutation, so either store will do.
function Reprice({ grid }: { grid: AnyDataGridStore<typeof schema.spec> }) {
  return <button onClick={async () => await grid.setCell(0, "price", 9.99)}>Reprice</button>;
}`;

const SHARING = `import { WasmStateSyncProvider } from "use-wasm-state";
import { defineDataGrid, useDataGridStats, useWasmDataGridSync } from "use-wasm-state/datagrid";

// Once, at module scope. Nothing loads until a component uses it.
export const Orders = defineDataGrid("orders", schema, { initialRows });

export function App() {
  return (
    <WasmStateSyncProvider>
      <OrderCount />
      <OrderList />
    </WasmStateSyncProvider>
  );
}

function OrderCount() {
  // The same grid in every component that names it.
  const { grid } = useWasmDataGridSync(Orders);
  return <p>{useDataGridStats(grid)?.rowCount}</p>;
}`;

const SERVING = `// Default: resolved next to the bundle, streaming compile kept.
useWasmDataGridSync(schema);

// Override for a CDN, a strict CSP, or a bundler that
// cannot resolve the asset.
useWasmDataGridSync(schema, { wasmUrl: "https://cdn.example.com/datagrid.wasm" });

// A provider takes the same, per pattern.
<WasmStateAsyncProvider urls={{ datagrid: { wasmUrl, workerUrl } }}>`;

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

      <Section title="A grid in twenty lines">
        <CodeBlock code={QUICK} label="tsx" />
      </Section>

      <Section title="Why the state lives in Go">
        <p className="text-muted-foreground text-sm">
          Storing arbitrary <Js /> values in <Wasm>wasm</Wasm> means serialising on every read,
          which is slower than <code>useState</code>. It only pays off when the operations on the
          state run in <Wasm>wasm</Wasm> too. So <Go /> owns the rows, the string dictionaries and
          the row order; React owns the scroll position and the selection. A counter on the grid
          bumps on every mutation, <code>useSyncExternalStore</code> watches that counter, and each
          component reads back only the rows it is showing.
        </p>
        <CodeBlock code={VIEWPORT} label="tsx" />
      </Section>

      <Section title="On the main thread">
        <p className="text-muted-foreground text-sm">
          <code>useWasmDataGridSync</code> runs the engine on the main thread, so a viewport is read
          during render and a mutation is visible on the next line. Nothing is a Promise and there
          is no transport to go wrong.
        </p>
      </Section>

      <Section title="In a worker">
        <p className="text-muted-foreground text-sm">
          <code>useWasmDataGridAsync</code> moves the engine off the main thread. Reads stay
          synchronous, because the worker sends rows for every window on screen with each reply, so
          one round trip covers a whole user action. Mutations return Promises, because they really
          do cross a thread.
        </p>
        <CodeBlock code={WORKER} label="tsx" />
        <p className="text-muted-foreground text-sm">
          The two stores differ only in what a mutation returns, and both satisfy{" "}
          <code>DataGridReader</code>, which is what the read hooks take. A component that awaits
          every mutation it makes can take <code>AnyDataGridStore</code> and run under either mode
          unchanged; on a sync store the <code>await</code> costs a microtask and nothing else. The
          200,000-row example is written that way.
        </p>
        <CodeBlock code={PORTABLE} label="tsx" />
      </Section>

      <Section title="Sharing a grid">
        <p className="text-muted-foreground text-sm">
          Define a grid once and name it wherever it is needed. The schema travels with the key, so
          two components cannot disagree about its shape. The provider creates the grid the first
          time a component asks, hands every component the same one, and keeps it until the provider
          unmounts, so the rows survive every component that showed them going away.{" "}
          <code>useWasmStateSync().drop(Orders)</code> throws it away; the next use starts again
          from <code>initialRows</code>. In a worker it is the same code with{" "}
          <code>WasmStateAsyncProvider</code> and <code>useWasmDataGridAsync</code>.
        </p>
        <CodeBlock code={SHARING} label="tsx" />
      </Section>

      <Section title="Serving the engine">
        <p className="text-muted-foreground text-sm">
          The datagrid's engine is <code>datagrid.wasm</code>, a 55 kB module that imports nothing,
          and its worker is <code>datagrid.worker.js</code>. Both are resolved with{" "}
          <code>new URL("./…", import.meta.url)</code>, which <Name>Vite</Name> and{" "}
          <Name>webpack 5</Name> both understand. The <Name>CJS</Name> build ships a shim for{" "}
          <code>import.meta.url</code>; if a bundler still cannot resolve the assets, pass the URLs.
        </p>
        <CodeBlock code={SERVING} label="tsx" />
      </Section>
    </div>
  );
}
