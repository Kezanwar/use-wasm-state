// @vitest-environment jsdom
import { StrictMode, useState } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  defineSchema,
  useDataGridQuery,
  useDataGridStats,
  useDataGridView,
  useWasmDataGridAsync,
  useWasmDataGridSync,
  type AsyncDataGridStore,
  type DataGridStore,
} from "../../src/datagrid/index";
import { ENGINE_URL, serveEngine } from "../helpers/engine";
import { stubWorker, workers } from "../helpers/fake-worker";

/**
 * The hooks, over the real engine in jsdom.
 *
 * Everything that matters here is lifecycle: a grid is a wasm instance and
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
  onGrid,
  wasmUrl = ENGINE_URL,
  initialRows,
}: {
  start?: number;
  count?: number;
  onGrid?: (grid: DataGridStore<Schema>) => void;
  wasmUrl?: string;
  initialRows?: { id: number; price: number; status: string }[];
}) {
  const { status, grid, error } = useWasmDataGridSync(schema, { wasmUrl, initialRows });
  const view = useDataGridView(grid, start, count);

  if (status === "loading") return <p>loading</p>;
  if (status === "error") return <p data-testid="error">{error.message}</p>;

  onGrid?.(grid);

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

describe("useWasmDataGridSync, given a schema", () => {
  it("goes from loading to ready", async () => {
    render(<Grid />);
    expect(screen.getByText("loading")).toBeTruthy();
    await waitFor(() => expect(screen.getByTestId("rows")).toBeTruthy());
  });

  it("loads initialRows exactly once", async () => {
    let grid!: DataGridStore<Schema>;
    render(
      <Grid
        onGrid={(t) => (grid = t)}
        initialRows={[
          { id: 1, price: 1.5, status: "new" },
          { id: 2, price: 2.5, status: "shipped" },
        ]}
      />
    );

    await waitFor(() => expect(screen.getByTestId("rows")).toBeTruthy());
    expect(grid.rowCount).toBe(2);
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
      const result = useWasmDataGridSync(which === 0 ? schema : (other as never), {
        wasmUrl: ENGINE_URL,
      });
      return (
        <button onClick={() => setWhich(1)}>
          {result.status === "ready" ? result.grid.schema.names.join(",") : "loading"}
        </button>
      );
    }

    render(<Switcher />);
    await waitFor(() => expect(screen.getByText("id,price,status")).toBeTruthy());

    await act(async () => void screen.getByRole("button").click());

    expect(warn).toHaveBeenCalledWith(expect.stringContaining("schema changed after mount"));
    // Still the original grid: a grid holding rows cannot be migrated.
    expect(screen.getByText("id,price,status")).toBeTruthy();
  });

  it("does not warn when the same schema shape is rebuilt each render", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    function Rebuilder() {
      const [n, setN] = useState(0);
      // A new object every render, same columns. Warning here would train
      // people to ignore the warning.
      const inline = defineSchema({ id: "i32", price: "f64", status: "string" });
      const result = useWasmDataGridSync(inline, { wasmUrl: ENGINE_URL });
      return <button onClick={() => setN(n + 1)}>{result.status}</button>;
    }

    render(<Rebuilder />);
    await waitFor(() => expect(screen.getByText("ready")).toBeTruthy());
    await act(async () => void screen.getByRole("button").click());

    expect(warn).not.toHaveBeenCalled();
  });

  it("does not reload the engine when wasmUrl is rebuilt each render", async () => {
    let engineLoads = 0;
    const serve = vi.fn(async () => {
      engineLoads++;
      return new Response(readFileSync(resolve(process.cwd(), "src/datagrid/datagrid.wasm")), {
        headers: { "content-type": "application/wasm" },
      });
    });
    vi.stubGlobal("fetch", serve);

    function Inline() {
      const [n, setN] = useState(0);
      // A new URL object every render, same address. Depending on the
      // object would tear the engine down and rebuild it each time.
      const { status } = useWasmDataGridSync(schema, { wasmUrl: new URL(ENGINE_URL) });
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

describe("useDataGridView", () => {
  it("re-renders when a visible cell changes", async () => {
    let grid!: DataGridStore<Schema>;
    let renders = 0;

    function Counted() {
      renders++;
      const { status, grid: t } = useWasmDataGridSync(schema, {
        wasmUrl: ENGINE_URL,
        initialRows: [{ id: 1, price: 1, status: "new" }],
      });
      const view = useDataGridView(t, 0, 10);
      if (status !== "ready") return <p>loading</p>;
      grid = t;
      return <p data-testid="cell">{view?.get(0, "id")}</p>;
    }

    render(<Counted />);
    await waitFor(() => expect(screen.getByTestId("cell").textContent).toBe("1"));

    const before = renders;
    await act(async () => grid.setCell(0, "id", 42));

    expect(screen.getByTestId("cell").textContent).toBe("42");
    expect(renders).toBeGreaterThan(before);
  });

  it("gives the same view object back while nothing changes", async () => {
    let grid!: DataGridStore<Schema>;
    render(<Grid onGrid={(t) => (grid = t)} initialRows={[{ id: 1, price: 1, status: "new" }]} />);
    await waitFor(() => expect(screen.getByTestId("rows")).toBeTruthy());

    // useSyncExternalStore re-renders forever if the snapshot is a fresh
    // object each time it is read.
    expect(grid.view(0, 10)).toBe(grid.view(0, 10));
  });

  it("returns null while the grid is still loading", async () => {
    function Early() {
      const view = useDataGridView<Schema>(null, 0, 10);
      return <p data-testid="view">{view === null ? "null" : "something"}</p>;
    }
    render(<Early />);
    expect(screen.getByTestId("view").textContent).toBe("null");
  });

  it("re-renders a component watching a different window only when its own rows move", async () => {
    let grid!: DataGridStore<Schema>;
    let farRenders = 0;

    function Far({ t }: { t: DataGridStore<Schema> | null }) {
      farRenders++;
      const view = useDataGridView(t, 100, 10);
      return <p data-testid="far">{view?.length ?? -1}</p>;
    }

    function Host() {
      const { status, grid: t } = useWasmDataGridSync(schema, { wasmUrl: ENGINE_URL });
      if (status === "ready") grid = t;
      return <Far t={status === "ready" ? t : null} />;
    }

    render(<Host />);
    await waitFor(() => expect(grid).toBeTruthy());

    await act(async () => {
      grid.insertColumns({
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
    await act(async () => grid.setCell(0, "id", 999));
    expect(screen.getByTestId("far").textContent).toBe(before);
    expect(farRenders).toBeGreaterThan(0);
  });
});

describe("under StrictMode", () => {
  it("leaks no grid and inserts initialRows once", async () => {
    const grids: DataGridStore<Schema>[] = [];

    render(
      <StrictMode>
        <Grid
          onGrid={(t) => {
            if (!grids.includes(t)) grids.push(t);
          }}
          initialRows={[{ id: 1, price: 1, status: "new" }]}
        />
      </StrictMode>
    );

    await waitFor(() => expect(screen.getByTestId("rows")).toBeTruthy());

    // StrictMode mounts, unmounts and mounts again. Exactly one grid
    // survives, holding exactly one row: the first engine was disposed the
    // moment it finished loading into a cancelled mount.
    const live = grids.filter((t) => {
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

  it("disposes the grid on unmount", async () => {
    let grid!: DataGridStore<Schema>;
    const { unmount } = render(<Grid onGrid={(t) => (grid = t)} />);
    await waitFor(() => expect(screen.getByTestId("rows")).toBeTruthy());

    unmount();
    expect(() => grid.rowCount).toThrowError(/disposed/);
  });
});

describe("two windows on one grid", () => {
  /** Two consumers of the same grid, each watching a different window. */
  function TwoWindows({ onGrid }: { onGrid: (t: DataGridStore<Schema>) => void }) {
    const { status, grid } = useWasmDataGridSync(schema, {
      wasmUrl: ENGINE_URL,
      initialRows: Array.from({ length: 200 }, (_, i) => ({
        id: i,
        price: i + 0.5,
        status: i % 2 ? "shipped" : "new",
      })),
    });
    if (status !== "ready") return <p>loading</p>;
    onGrid(grid);
    return (
      <>
        <Window grid={grid} start={0} testid="top" />
        <Window grid={grid} start={100} testid="bottom" />
      </>
    );
  }

  function Window({
    grid,
    start,
    testid,
  }: {
    grid: DataGridStore<Schema>;
    start: number;
    testid: string;
  }) {
    const view = useDataGridView(grid, start, 5);
    return (
      <p data-testid={testid}>
        {view ? `${view.start}:${view.get(0, "id")}:${view.get(0, "price")}` : "none"}
      </p>
    );
  }

  it("keeps both snapshots correct and warns about neither", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    let grid!: DataGridStore<Schema>;

    render(
      <StrictMode>
        <TwoWindows onGrid={(t) => (grid = t)} />
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

    await act(async () => grid.setCell(100, "price", 9.75));

    expect(screen.getByTestId("bottom").textContent).toBe("100:100:9.75");
    expect(screen.getByTestId("top").textContent).toBe("0:0:0.5");
  });
});

describe("useDataGridStats", () => {
  function Stats({ onGrid }: { onGrid?: (t: DataGridStore<Schema>) => void }) {
    const { status, grid } = useWasmDataGridSync(schema, { wasmUrl: ENGINE_URL });
    const stats = useDataGridStats(grid);
    if (status === "ready") onGrid?.(grid);
    return (
      <p data-testid="stats">
        {stats ? `${stats.revision}/${stats.rowCount}/${stats.totalRows}` : "none"}
      </p>
    );
  }

  it("is null until the grid exists, then tracks it", async () => {
    let grid!: DataGridStore<Schema>;
    render(<Stats onGrid={(t) => (grid = t)} />);

    expect(screen.getByTestId("stats").textContent).toBe("none");
    await waitFor(() => expect(screen.getByTestId("stats").textContent).toBe("0/0/0"));

    await act(async () => void grid.insertRows([{ id: 1, price: 1, status: "new" }]));
    expect(screen.getByTestId("stats").textContent).toBe("1/1/1");

    await act(async () => grid.deleteRows([0]));
    // The tombstone stays, so totalRows holds where rowCount drops.
    expect(screen.getByTestId("stats").textContent).toBe("2/0/1");
  });

  it("does not change identity while the revision holds", async () => {
    let grid!: DataGridStore<Schema>;
    const seen: unknown[] = [];

    function Watcher() {
      const { status, grid: t } = useWasmDataGridSync(schema, { wasmUrl: ENGINE_URL });
      const stats = useDataGridStats(t);
      seen.push(stats);
      if (status === "ready") grid = t;
      return <p data-testid="n">{stats?.rowCount ?? -1}</p>;
    }

    render(<Watcher />);
    await waitFor(() => expect(screen.getByTestId("n").textContent).toBe("0"));

    const before = seen[seen.length - 1];
    await act(async () => void grid.insertRows([{ id: 1, price: 1, status: "new" }]));
    const after = seen[seen.length - 1];

    expect(after).not.toBe(before);
    expect(after).toEqual({ revision: 1, rowCount: 1, totalRows: 1 });
  });
});

describe("useDataGridQuery", () => {
  it("tracks the query and is null while loading", async () => {
    let grid!: DataGridStore<Schema>;

    function Toolbar() {
      const { status, grid: t } = useWasmDataGridSync(schema, {
        wasmUrl: ENGINE_URL,
        initialRows: [
          { id: 1, price: 30, status: "paid" },
          { id: 2, price: 10, status: "new" },
        ],
      });
      const query = useDataGridQuery(t);
      if (status === "ready") grid = t;
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

    await act(async () => grid.sortBy("price", "desc"));
    expect(screen.getByTestId("query").textContent).toBe("price:desc|0|");

    await act(async () => grid.search("pa"));
    expect(screen.getByTestId("query").textContent).toBe("price:desc|0|pa");

    await act(async () => grid.filter([{ column: "status", op: "eq", value: "paid" }]));
    expect(screen.getByTestId("query").textContent).toBe("price:desc|1|pa");

    await act(async () => grid.clearQuery());
    expect(screen.getByTestId("query").textContent).toBe("|0|");
  });

  it("re-renders the rows and the toolbar on one revision bump", async () => {
    let grid!: DataGridStore<Schema>;

    function Both() {
      const { status, grid: t } = useWasmDataGridSync(schema, {
        wasmUrl: ENGINE_URL,
        initialRows: [
          { id: 1, price: 30, status: "paid" },
          { id: 2, price: 10, status: "new" },
        ],
      });
      const query = useDataGridQuery(t);
      const view = useDataGridView(t, 0, 10);
      if (status === "ready") grid = t;
      return (
        <>
          <p data-testid="sorted">{query?.sort[0]?.column ?? "none"}</p>
          <p data-testid="first">{view?.get(0, "id") ?? -1}</p>
        </>
      );
    }

    render(<Both />);
    await waitFor(() => expect(screen.getByTestId("first").textContent).toBe("1"));

    await act(async () => grid.sortBy("price", "asc"));
    // Both read the same revision, so neither can be a frame behind.
    expect(screen.getByTestId("sorted").textContent).toBe("price");
    expect(screen.getByTestId("first").textContent).toBe("2");
  });
});

describe("useWasmDataGridAsync, given a schema", () => {
  beforeAll(() => stubWorker());

  function AsyncGrid({ onGrid }: { onGrid?: (grid: AsyncDataGridStore<Schema>) => void }) {
    const { status, grid } = useWasmDataGridAsync(schema, {
      wasmUrl: ENGINE_URL,
      initialRows: [{ id: 1, price: 1, status: "new" }],
    });
    const view = useDataGridView(grid, 0, 10);
    if (status === "ready") onGrid?.(grid);
    return <p data-testid="async">{view ? `${view.length}:${view.get(0, "status")}` : status}</p>;
  }

  it("loads in a worker, with initialRows once under StrictMode", async () => {
    const grids = new Set<AsyncDataGridStore<Schema>>();
    workers.length = 0;
    render(
      <StrictMode>
        <AsyncGrid onGrid={(g) => grids.add(g)} />
      </StrictMode>
    );
    await waitFor(() => expect(screen.getByTestId("async").textContent).toBe("1:new"));

    expect(grids.size).toBe(1);
    expect([...grids][0]!.totalRows).toBe(1);
    // The first mount's worker went the moment its engine arrived into a
    // cancelled mount; only one is still running.
    expect(workers.filter((w) => !w.terminated)).toHaveLength(1);
  });

  it("terminates its worker on unmount", async () => {
    workers.length = 0;
    const { unmount } = render(<AsyncGrid />);
    await waitFor(() => expect(screen.getByTestId("async").textContent).toBe("1:new"));
    unmount();
    expect(workers.every((w) => w.terminated)).toBe(true);
  });

  it("returns Promises from its mutations, and the rows follow", async () => {
    let grid!: AsyncDataGridStore<Schema>;
    render(<AsyncGrid onGrid={(g) => (grid = g)} />);
    await waitFor(() => expect(screen.getByTestId("async").textContent).toBe("1:new"));

    await act(async () => {
      await grid.setCell(0, "status", "shipped");
    });
    await waitFor(() => expect(screen.getByTestId("async").textContent).toBe("1:shipped"));
  });
});
