// @vitest-environment jsdom
import { StrictMode, useState } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { defineSchema, useTableView, useWasmTable, type TableStore } from "../src/index";
import { ENGINE_URL, serveEngine } from "./helpers/engine";

/**
 * The hooks, over the real engine in jsdom.
 *
 * Everything that matters here is lifecycle: a table is a wasm instance and
 * a chunk of linear memory, so a leaked one is not a tidiness problem. The
 * StrictMode test is the important one.
 */

const schema = defineSchema({ id: "i32", price: "f64", status: "string" });
type Schema = typeof schema.spec;

beforeAll(() => serveEngine());
afterAll(() => vi.unstubAllGlobals());
// Testing Library only registers its own cleanup when vitest runs with
// globals on, and this config does not. Without it every render stacks up
// in the same document and the next test finds two of everything.
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Grid({
  start = 0,
  count = 10,
  onTable,
  wasmUrl = ENGINE_URL,
  initialRows,
}: {
  start?: number;
  count?: number;
  onTable?: (table: TableStore<Schema>) => void;
  wasmUrl?: string;
  initialRows?: { id: number; price: number; status: string }[];
}) {
  const { status, table, error } = useWasmTable(schema, { wasmUrl, initialRows });
  const view = useTableView(table, start, count);

  if (status === "loading") return <p>loading</p>;
  if (status === "error") return <p data-testid="error">{error.message}</p>;

  onTable?.(table);

  return (
    <ul data-testid="rows">
      {view?.rows().map((row, i) => (
        <li key={view.ids[i]}>
          {row.id}:{row.price}:{row.status}
        </li>
      ))}
    </ul>
  );
}

describe("useWasmTable", () => {
  it("goes from loading to ready", async () => {
    render(<Grid />);
    expect(screen.getByText("loading")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("rows")).toBeTruthy());
  });

  it("loads initialRows exactly once", async () => {
    let table!: TableStore<Schema>;
    render(
      <Grid
        onTable={(t) => (table = t)}
        initialRows={[
          { id: 1, price: 1.5, status: "new" },
          { id: 2, price: 2.5, status: "shipped" },
        ]}
      />
    );

    await waitFor(() => expect(screen.getByTestId("rows")).toBeTruthy());
    expect(table.rowCount).toBe(2);
    expect(screen.getByText("1:1.5:new")).toBeTruthy();
  });

  it("reports a bad wasm url as an error", async () => {
    // A 404 rather than a stub failure, so the loader's own message is the
    // one that reaches the component.
    vi.stubGlobal(
      "fetch",
      async () => new Response(null, { status: 404, statusText: "Not Found" })
    );

    render(<Grid wasmUrl="https://engine.test/missing.wasm" />);
    await waitFor(() => expect(screen.getByTestId("error")).toBeTruthy());
    expect(screen.getByTestId("error").textContent).toMatch(/failed to fetch|404/);

    serveEngine();
  });

  it("warns when the schema changes shape after mount, and ignores it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const other = defineSchema({ id: "i32" });

    function Switcher() {
      const [which, setWhich] = useState(0);
      const result = useWasmTable(which === 0 ? schema : (other as never), { wasmUrl: ENGINE_URL });
      return (
        <button onClick={() => setWhich(1)}>
          {result.status === "ready" ? result.table.schema.names.join(",") : "loading"}
        </button>
      );
    }

    render(<Switcher />);
    await waitFor(() => expect(screen.getByText("id,price,status")).toBeTruthy());

    await act(async () => void screen.getByRole("button").click());

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("schema changed after mount"));
    // Still the original table: a table holding rows cannot be migrated.
    expect(screen.getByText("id,price,status")).toBeTruthy();
  });

  it("does not warn when the same schema shape is rebuilt each render", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    function Rebuilder() {
      const [n, setN] = useState(0);
      // A new object every render, same columns. Warning here would train
      // people to ignore the warning.
      const inline = defineSchema({ id: "i32", price: "f64", status: "string" });
      const result = useWasmTable(inline, { wasmUrl: ENGINE_URL });
      return <button onClick={() => setN(n + 1)}>{result.status}</button>;
    }

    render(<Rebuilder />);
    await waitFor(() => expect(screen.getByText("ready")).toBeTruthy());
    await act(async () => void screen.getByRole("button").click());

    expect(warn).not.toHaveBeenCalled();
  });

  it("throws a clear message for options that are not built yet", async () => {
    const errors: unknown[] = [];
    function Shared() {
      try {
        useWasmTable(schema, { wasmUrl: ENGINE_URL, shared: "orders" });
      } catch (err) {
        errors.push(err);
      }
      return <p>ok</p>;
    }
    // The throw happens inside the effect, so React surfaces it rather
    // than the try/catch above; catching it at the boundary is enough to
    // prove it is loud.
    const onError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Shared />)).toThrowError(/shared is not implemented yet/);
    onError.mockRestore();
  });
});

describe("useTableView", () => {
  it("re-renders when a visible cell changes", async () => {
    let table!: TableStore<Schema>;
    let renders = 0;

    function Counted() {
      renders++;
      const { status, table: t } = useWasmTable(schema, {
        wasmUrl: ENGINE_URL,
        initialRows: [{ id: 1, price: 1, status: "new" }],
      });
      const view = useTableView(t, 0, 10);
      if (status !== "ready") return <p>loading</p>;
      table = t;
      return <p data-testid="cell">{view?.get(0, "id")}</p>;
    }

    render(<Counted />);
    await waitFor(() => expect(screen.getByTestId("cell").textContent).toBe("1"));

    const before = renders;
    await act(async () => table.setCell(0, "id", 42));

    expect(screen.getByTestId("cell").textContent).toBe("42");
    expect(renders).toBeGreaterThan(before);
  });

  it("gives the same view object back while nothing changes", async () => {
    let table!: TableStore<Schema>;
    render(
      <Grid onTable={(t) => (table = t)} initialRows={[{ id: 1, price: 1, status: "new" }]} />
    );
    await waitFor(() => expect(screen.getByTestId("rows")).toBeTruthy());

    // useSyncExternalStore re-renders forever if the snapshot is a fresh
    // object each time it is read.
    expect(table.view(0, 10)).toBe(table.view(0, 10));
  });

  it("returns null while the table is still loading", async () => {
    function Early() {
      const view = useTableView<Schema>(null, 0, 10);
      return <p data-testid="view">{view === null ? "null" : "something"}</p>;
    }
    render(<Early />);
    expect(screen.getByTestId("view").textContent).toBe("null");
  });

  it("re-renders a component watching a different window only when its own rows move", async () => {
    let table!: TableStore<Schema>;
    let farRenders = 0;

    function Far({ t }: { t: TableStore<Schema> | null }) {
      farRenders++;
      const view = useTableView(t, 100, 10);
      return <p data-testid="far">{view?.length ?? -1}</p>;
    }

    function Host() {
      const { status, table: t } = useWasmTable(schema, { wasmUrl: ENGINE_URL });
      if (status === "ready") table = t;
      return <Far t={status === "ready" ? t : null} />;
    }

    render(<Host />);
    await waitFor(() => expect(table).toBeTruthy());

    await act(async () => {
      table.insertColumns({
        id: Int32Array.from({ length: 200 }, (_, i) => i),
        price: Float64Array.from({ length: 200 }, (_, i) => i),
        status: Array.from({ length: 200 }, () => "new"),
      });
    });
    await waitFor(() => expect(screen.getByTestId("far").textContent).toBe("10"));

    // An edit well outside the window still bumps the revision, so the
    // component is asked for a fresh snapshot. What it must not do is
    // produce different rows.
    const before = screen.getByTestId("far").textContent;
    await act(async () => table.setCell(0, "id", 999));
    expect(screen.getByTestId("far").textContent).toBe(before);
    expect(farRenders).toBeGreaterThan(0);
  });
});

describe("under StrictMode", () => {
  it("leaks no table and inserts initialRows once", async () => {
    const tables: TableStore<Schema>[] = [];

    render(
      <StrictMode>
        <Grid
          onTable={(t) => {
            if (!tables.includes(t)) tables.push(t);
          }}
          initialRows={[{ id: 1, price: 1, status: "new" }]}
        />
      </StrictMode>
    );

    await waitFor(() => expect(screen.getByTestId("rows")).toBeTruthy());

    // StrictMode mounts, unmounts and mounts again. Exactly one table
    // survives, holding exactly one row: the first engine was disposed the
    // moment it finished loading into a cancelled mount.
    const live = tables.filter((t) => {
      try {
        t.rowCount;
        return true;
      } catch {
        return false;
      }
    });
    expect(live).toHaveLength(1);
    expect(live[0]!.rowCount).toBe(1);
    expect(screen.getAllByRole("listitem")).toHaveLength(1);
  });

  it("disposes the table on unmount", async () => {
    let table!: TableStore<Schema>;
    const { unmount } = render(<Grid onTable={(t) => (table = t)} />);
    await waitFor(() => expect(screen.getByTestId("rows")).toBeTruthy());

    unmount();
    expect(() => table.rowCount).toThrowError(/disposed/);
  });
});
