import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defineSchema, useTableView, useWasmTable } from "../src/index";

/**
 * Server rendering.
 *
 * Deliberately *not* jsdom: this file runs in plain Node, so anything that
 * reaches for window, document, fetch or WebAssembly during render fails
 * here rather than in someone's Next.js build. The hooks must render the
 * loading state and touch nothing.
 */

const schema = defineSchema({ id: "i32", price: "f64", status: "string" });

function Grid() {
  const { status, table } = useWasmTable(schema);
  const view = useTableView(table, 0, 10);
  return (
    <main>
      <span data-status={status}>{status}</span>
      <span data-rows={view === null ? "none" : String(view.length)} />
    </main>
  );
}

describe("server rendering", () => {
  it("renders the loading state", () => {
    const html = renderToString(<Grid />);
    expect(html).toContain('data-status="loading"');
    // useTableView falls back to its server snapshot, which is the same
    // null the client starts from, so hydration has nothing to reconcile.
    expect(html).toContain('data-rows="none"');
  });

  it("touches no browser globals", () => {
    // Effects never run on the server, so the engine is never loaded and
    // no fetch is attempted. Proving it by removing the globals a load
    // would need.
    const names = ["window", "document", "fetch", "WebAssembly"] as const;
    const saved = new Map<string, unknown>();
    for (const name of names) {
      saved.set(name, (globalThis as Record<string, unknown>)[name]);
      delete (globalThis as Record<string, unknown>)[name];
    }

    try {
      expect(() => renderToString(<Grid />)).not.toThrow();
    } finally {
      for (const [name, value] of saved) {
        if (value !== undefined) (globalThis as Record<string, unknown>)[name] = value;
      }
    }
  });

  it("defines a schema without a DOM", () => {
    // defineSchema runs at module scope in most apps, so it has to work
    // wherever the module is imported.
    const s = defineSchema({ a: "i32", b: "string" });
    expect(s.names).toEqual(["a", "b"]);
    expect(s.kinds).toEqual(["i32", "string"]);
  });
});
