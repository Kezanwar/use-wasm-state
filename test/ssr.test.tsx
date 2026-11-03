import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WasmStateAsyncProvider, WasmStateSyncProvider } from "../src/index";
import {
  defineDataGrid,
  defineSchema,
  useDataGridQuery,
  useDataGridStats,
  useDataGridView,
  useWasmDataGridAsync,
  useWasmDataGridSync,
  type AnyDataGridStore,
  type UseWasmDataGridResult,
} from "../src/datagrid/index";

/**
 * Server rendering.
 *
 * Deliberately *not* jsdom: this file runs in plain Node, so anything that
 * reaches for window, document, fetch, Worker or WebAssembly during render
 * fails here rather than in someone's Next.js build. Providers and hooks
 * must render their loading state and touch nothing.
 */

const schema = defineSchema({ id: "i32", price: "f64", status: "string" });
// At module scope, the way an app defines one.
const Orders = defineDataGrid("orders", schema, {
  initialRows: [{ id: 1, price: 1, status: "new" }],
});

function Show({ result }: { result: UseWasmDataGridResult<AnyDataGridStore<typeof schema.spec>> }) {
  const view = useDataGridView(result.grid, 0, 10);
  const stats = useDataGridStats(result.grid);
  const query = useDataGridQuery(result.grid);
  return (
    <span
      data-status={result.status}
      data-rows={view === null ? "none" : String(view.length)}
      data-stats={stats === null ? "none" : String(stats.rowCount)}
      data-query={query === null ? "none" : "some"}
      data-error={result.error?.message ?? ""}
    />
  );
}

const SyncShared = () => <Show result={useWasmDataGridSync(Orders)} />;
const AsyncShared = () => <Show result={useWasmDataGridAsync(Orders)} />;
const SyncOneOff = () => <Show result={useWasmDataGridSync(schema)} />;
const AsyncOneOff = () => <Show result={useWasmDataGridAsync(schema)} />;

function App() {
  return (
    <WasmStateSyncProvider>
      <WasmStateAsyncProvider>
        <SyncShared />
        <AsyncShared />
        <SyncOneOff />
        <AsyncOneOff />
      </WasmStateAsyncProvider>
    </WasmStateSyncProvider>
  );
}

/** Render with the globals a load would need removed. */
function withoutBrowser<T>(run: () => T): T {
  const names = ["window", "document", "fetch", "WebAssembly", "Worker"] as const;
  const saved = new Map<string, unknown>();
  for (const name of names) {
    saved.set(name, (globalThis as Record<string, unknown>)[name]);
    delete (globalThis as Record<string, unknown>)[name];
  }
  try {
    return run();
  } finally {
    for (const [name, value] of saved) {
      if (value !== undefined) (globalThis as Record<string, unknown>)[name] = value;
    }
  }
}

describe("server rendering", () => {
  it("renders providers and every hook in their loading state", () => {
    const html = renderToString(<App />);
    expect(html.match(/data-status="loading"/g)).toHaveLength(4);
    // The read hooks fall back to their server snapshot, which is the same
    // null the client starts from, so hydration has nothing to reconcile.
    expect(html).not.toMatch(/data-rows="\d/);
    expect(html).not.toMatch(/data-stats="\d/);
    expect(html).not.toContain('data-query="some"');
  });

  it("touches no browser globals", () => {
    // Effects never run on the server, so no engine is loaded and no fetch
    // is attempted. Proving it by removing what a load would need.
    expect(() => withoutBrowser(() => renderToString(<App />))).not.toThrow();
  });

  it("reports a missing provider there too", () => {
    const html = withoutBrowser(() => renderToString(<SyncShared />));
    expect(html).toContain('data-status="error"');
    expect(html).toContain("WasmStateSyncProvider");
  });

  it("defines schemas and grids without a DOM", () => {
    const def = withoutBrowser(() => defineDataGrid("x", defineSchema({ a: "i32", b: "string" })));
    expect(def.key).toBe("x");
    expect(def.schema.names).toEqual(["a", "b"]);
  });
});
