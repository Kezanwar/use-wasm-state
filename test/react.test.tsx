// @vitest-environment jsdom
import { StrictMode, useState } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  defineSchema,
  useTableQuery,
  useTableStats,
  useTableView,
  useWasmTable,
  WasmStateError,
  type TableStore,
} from "../src/index";
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

  it("reports an option that is not built yet through status, not a throw", async () => {
    // shared is the only one left: worker mode is built, and jsdom has no
    // Worker, so it is covered by the browser suite instead.
    function Unsupported({ options }: { options: Record<string, unknown> }) {
      const { status, error } = useWasmTable(schema, { wasmUrl: ENGINE_URL, ...options });
      return <p data-testid="state">{status === "error" ? error.message : status}</p>;
    }

    const view = render(<Unsupported options={{ shared: "orders" }} />);
    await waitFor(() =>
      expect(screen.getByTestId("state").textContent).toMatch(/not implemented yet/)
    );
    view.unmount();
  });

  it("gives that error the not_implemented code", async () => {
    let caught: WasmStateError | null = null;
    function Unsupported() {
      const result = useWasmTable(schema, { wasmUrl: ENGINE_URL, shared: "orders" });
      if (result.status === "error") caught = result.error as WasmStateError;
      return <p>{result.status}</p>;
    }
    render(<Unsupported />);
    // An unbuilt option is a failure of the hook, handled like a missing
    // .wasm, rather than something needing an error boundary.
    await waitFor(() => expect(caught).toBeInstanceOf(WasmStateError));
    expect(caught!.code).toBe("not_implemented");
  });

  it("does not reload the engine when wasmUrl is rebuilt each render", async () => {
    let engineLoads = 0;
    const serve = vi.fn(async () => {
      engineLoads++;
      return new Response(readFileSync(resolve(process.cwd(), "src/wasm/engine.wasm")), {
        headers: { "content-type": "application/wasm" },
      });
    });
    vi.stubGlobal("fetch", serve);

    function Inline() {
      const [n, setN] = useState(0);
      // A new URL object every render, same address. Depending on the
      // object would tear the engine down and rebuild it each time.
      const { status } = useWasmTable(schema, { wasmUrl: new URL(ENGINE_URL) });
      return <button onClick={() => setN(n + 1)}>{`${status}${n}`}</button>;
    }

    render(<Inline />);
    await waitFor(() => expect(screen.getByText("ready0")).toBeTruthy());
    const after = engineLoads;

    await act(async () => void screen.getByRole("button").click());
    await act(async () => void screen.getByRole("button").click());

    expect(engineLoads).toBe(after);
    serveEngine();
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

describe("two windows on one table", () => {
  /** Two consumers of the same table, each watching a different window. */
  function TwoWindows({ onTable }: { onTable: (t: TableStore<Schema>) => void }) {
    const { status, table } = useWasmTable(schema, {
      wasmUrl: ENGINE_URL,
      initialRows: Array.from({ length: 200 }, (_, i) => ({
        id: i,
        price: i + 0.5,
        status: i % 2 ? "shipped" : "new",
      })),
    });
    if (status !== "ready") return <p>loading</p>;
    onTable(table);
    return (
      <>
        <Window table={table} start={0} testid="top" />
        <Window table={table} start={100} testid="bottom" />
      </>
    );
  }

  function Window({
    table,
    start,
    testid,
  }: {
    table: TableStore<Schema>;
    start: number;
    testid: string;
  }) {
    const view = useTableView(table, start, 5);
    return (
      <p data-testid={testid}>
        {view ? `${view.start}:${view.get(0, "id")}:${view.get(0, "price")}` : "none"}
      </p>
    );
  }

  it("keeps both snapshots correct and warns about neither", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let table!: TableStore<Schema>;

    render(
      <StrictMode>
        <TwoWindows onTable={(t) => (table = t)} />
      </StrictMode>
    );
    await waitFor(() => expect(screen.getByTestId("top")).toBeTruthy());

    expect(screen.getByTestId("top").textContent).toBe("0:0:0.5");
    expect(screen.getByTestId("bottom").textContent).toBe("100:100:100.5");

    // The store caches one window. If a snapshot were the view object,
    // these two would evict each other and React would complain that
    // getSnapshot is not cached.
    const complaints = [...warn.mock.calls, ...error.mock.calls]
      .flat()
      .filter((arg) => typeof arg === "string" && /getSnapshot/i.test(arg));
    expect(complaints).toEqual([]);

    await act(async () => table.setCell(100, "price", 9.75));

    expect(screen.getByTestId("bottom").textContent).toBe("100:100:9.75");
    expect(screen.getByTestId("top").textContent).toBe("0:0:0.5");
  });
});

describe("useTableStats", () => {
  function Stats({ onTable }: { onTable?: (t: TableStore<Schema>) => void }) {
    const { status, table } = useWasmTable(schema, { wasmUrl: ENGINE_URL });
    const stats = useTableStats(table);
    if (status === "ready") onTable?.(table);
    return (
      <p data-testid="stats">
        {stats ? `${stats.revision}/${stats.rowCount}/${stats.totalRows}` : "none"}
      </p>
    );
  }

  it("is null until the table exists, then tracks it", async () => {
    let table!: TableStore<Schema>;
    render(<Stats onTable={(t) => (table = t)} />);

    expect(screen.getByTestId("stats").textContent).toBe("none");
    await waitFor(() => expect(screen.getByTestId("stats").textContent).toBe("0/0/0"));

    await act(async () => void table.insertRows([{ id: 1, price: 1, status: "new" }]));
    expect(screen.getByTestId("stats").textContent).toBe("1/1/1");

    await act(async () => table.deleteRows([0]));
    // The tombstone stays, so totalRows holds where rowCount drops.
    expect(screen.getByTestId("stats").textContent).toBe("2/0/1");
  });

  it("does not change identity while the revision holds", async () => {
    let table!: TableStore<Schema>;
    const seen: unknown[] = [];

    function Watcher() {
      const { status, table: t } = useWasmTable(schema, { wasmUrl: ENGINE_URL });
      const stats = useTableStats(t);
      seen.push(stats);
      if (status === "ready") table = t;
      return <p data-testid="n">{stats?.rowCount ?? -1}</p>;
    }

    render(<Watcher />);
    await waitFor(() => expect(screen.getByTestId("n").textContent).toBe("0"));

    const before = seen[seen.length - 1];
    await act(async () => void table.insertRows([{ id: 1, price: 1, status: "new" }]));
    const after = seen[seen.length - 1];

    expect(after).not.toBe(before);
    expect(after).toEqual({ revision: 1, rowCount: 1, totalRows: 1 });
  });
});

describe("useTableQuery", () => {
  it("tracks the query and is null while loading", async () => {
    let table!: TableStore<Schema>;

    function Toolbar() {
      const { status, table: t } = useWasmTable(schema, {
        wasmUrl: ENGINE_URL,
        initialRows: [
          { id: 1, price: 30, status: "paid" },
          { id: 2, price: 10, status: "new" },
        ],
      });
      const query = useTableQuery(t);
      if (status === "ready") table = t;
      return (
        <p data-testid="query">
          {query === null
            ? "none"
            : `${query.sort.map((s) => `${s.column}:${s.direction}`).join(",")}|${
                query.filters.length
              }|${query.search}`}
        </p>
      );
    }

    render(<Toolbar />);
    expect(screen.getByTestId("query").textContent).toBe("none");
    await waitFor(() => expect(screen.getByTestId("query").textContent).toBe("|0|"));

    await act(async () => table.sortBy("price", "desc"));
    expect(screen.getByTestId("query").textContent).toBe("price:desc|0|");

    await act(async () => table.search("pa"));
    expect(screen.getByTestId("query").textContent).toBe("price:desc|0|pa");

    await act(async () => table.filter([{ column: "status", op: "eq", value: "paid" }]));
    expect(screen.getByTestId("query").textContent).toBe("price:desc|1|pa");

    await act(async () => table.clearQuery());
    expect(screen.getByTestId("query").textContent).toBe("|0|");
  });

  it("re-renders the rows and the toolbar on one revision bump", async () => {
    let table!: TableStore<Schema>;

    function Both() {
      const { status, table: t } = useWasmTable(schema, {
        wasmUrl: ENGINE_URL,
        initialRows: [
          { id: 1, price: 30, status: "paid" },
          { id: 2, price: 10, status: "new" },
        ],
      });
      const query = useTableQuery(t);
      const view = useTableView(t, 0, 10);
      if (status === "ready") table = t;
      return (
        <>
          <p data-testid="sorted">{query?.sort[0]?.column ?? "none"}</p>
          <p data-testid="first">{view?.get(0, "id") ?? -1}</p>
        </>
      );
    }

    render(<Both />);
    await waitFor(() => expect(screen.getByTestId("first").textContent).toBe("1"));

    await act(async () => table.sortBy("price", "asc"));
    // Both read the same revision, so neither can be a frame behind.
    expect(screen.getByTestId("sorted").textContent).toBe("price");
    expect(screen.getByTestId("first").textContent).toBe("2");
  });
});
