// @vitest-environment jsdom
import { StrictMode, useState } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  useWasmStateAsync,
  useWasmStateSync,
  WasmStateAsyncProvider,
  WasmStateError,
  WasmStateSyncProvider,
  type WasmState,
} from "../../src/index";
import {
  defineDataGrid,
  defineSchema,
  useDataGridStats,
  useWasmDataGridAsync,
  useWasmDataGridSync,
  type AnyDataGridStore,
  type DataGridDef,
  type UseWasmDataGridResult,
} from "../../src/datagrid/index";
import { ENGINE_URL, serveEngine } from "../helpers/engine";
import { stubWorker } from "../helpers/fake-worker";

/**
 * The providers, over the real engine, in both modes.
 *
 * What matters is lifetime. A shared grid belongs to its provider, not to
 * the components showing it: it is made once, survives every consumer
 * unmounting, and goes only when it is dropped or the provider goes.
 */

const schema = defineSchema({ item: "string", qty: "i32" });
type Schema = typeof schema.spec;
const SEED = [
  { item: "Keyboard", qty: 2 },
  { item: "Cable", qty: 8 },
];
const Basket = defineDataGrid("basket", schema, { initialRows: SEED });

const URLS = { datagrid: { wasmUrl: ENGINE_URL } };

beforeAll(() => {
  serveEngine();
  stubWorker();
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type UseGrid = (def: DataGridDef<Schema>) => UseWasmDataGridResult<AnyDataGridStore<Schema>>;

const MODES = [
  {
    name: "sync",
    Provider: WasmStateSyncProvider,
    useGrid: useWasmDataGridSync as UseGrid,
    useWasmState: useWasmStateSync,
    provider: "WasmStateSyncProvider",
  },
  {
    name: "async",
    Provider: WasmStateAsyncProvider,
    useGrid: useWasmDataGridAsync as UseGrid,
    useWasmState: useWasmStateAsync,
    provider: "WasmStateAsyncProvider",
  },
] as const;

/** Engines made, counted where every one of them starts. */
const instantiations = () => vi.spyOn(WebAssembly, "instantiate");

/** A grid that has been disposed throws on any read. */
const alive = (grid: AnyDataGridStore<Schema>) => {
  try {
    void grid.rowCount;
    return true;
  } catch {
    return false;
  }
};

for (const mode of MODES) {
  const { Provider, useGrid, useWasmState } = mode;

  function Count({
    def = Basket,
    id = "count",
    onGrid,
  }: {
    def?: DataGridDef<Schema>;
    id?: string;
    onGrid?: (grid: AnyDataGridStore<Schema>) => void;
  }) {
    const { status, grid, error } = useGrid(def);
    const stats = useDataGridStats(grid);
    if (status === "error") return <p data-testid={id}>{(error as WasmStateError).code}</p>;
    if (status === "ready") onGrid?.(grid);
    return <p data-testid={id}>{stats ? stats.rowCount : "loading"}</p>;
  }

  function Adder() {
    const { grid } = useGrid(Basket);
    return (
      <button data-testid="add" onClick={() => void grid?.insertRows([{ item: "Mouse", qty: 1 }])}>
        add
      </button>
    );
  }

  /** Grabs the provider's controls, for the test to call. */
  function Controls({ onState }: { onState: (state: WasmState) => void }) {
    onState(useWasmState());
    return null;
  }

  const shown = (id = "count") => screen.getByTestId(id).textContent;

  describe(`${mode.name}: the provider`, () => {
    it("creates a shared grid on first use, with its initial rows", async () => {
      render(
        <Provider urls={URLS}>
          <Count />
        </Provider>
      );
      expect(shown()).toBe("loading");
      await waitFor(() => expect(shown()).toBe("2"));
    });

    it("hands every component the same grid", async () => {
      const seen = new Set<AnyDataGridStore<Schema>>();
      render(
        <Provider urls={URLS}>
          <Count id="a" onGrid={(g) => seen.add(g)} />
          <Count id="b" onGrid={(g) => seen.add(g)} />
          <Adder />
        </Provider>
      );
      await waitFor(() => expect(shown("b")).toBe("2"));
      expect(seen.size).toBe(1);

      // A mutation in one component is the other's data too.
      await act(async () => screen.getByTestId("add").click());
      await waitFor(() => expect(shown("a")).toBe("3"));
      expect(shown("b")).toBe("3");
    });

    it("keeps the data when every consumer unmounts", async () => {
      const made = instantiations();
      const seen = new Set<AnyDataGridStore<Schema>>();
      let show!: (on: boolean) => void;

      function Toggle() {
        const [on, setOn] = useState(true);
        show = setOn;
        return on ? (
          <>
            <Count onGrid={(g) => seen.add(g)} />
            <Adder />
          </>
        ) : null;
      }

      render(
        <Provider urls={URLS}>
          <Toggle />
        </Provider>
      );
      await waitFor(() => expect(shown()).toBe("2"));
      await act(async () => screen.getByTestId("add").click());
      await waitFor(() => expect(shown()).toBe("3"));

      await act(async () => show(false));
      expect(screen.queryByTestId("count")).toBeNull();
      await act(async () => show(true));

      // The same grid, with the row added before, and no second engine.
      await waitFor(() => expect(shown()).toBe("3"));
      expect(seen.size).toBe(1);
      expect([...seen].every(alive)).toBe(true);
      expect(made).toHaveBeenCalledTimes(1);
    });

    it("drops a grid, and gives anything showing it a fresh one", async () => {
      let state!: WasmState;
      const seen: AnyDataGridStore<Schema>[] = [];
      render(
        <Provider urls={URLS}>
          <Controls onState={(s) => (state = s)} />
          <Count onGrid={(g) => !seen.includes(g) && seen.push(g)} />
          <Adder />
        </Provider>
      );
      await waitFor(() => expect(shown()).toBe("2"));
      await act(async () => screen.getByTestId("add").click());
      await waitFor(() => expect(shown()).toBe("3"));

      await act(async () => state.drop(Basket));

      // Recreated from the definition: the initial rows again, not the
      // three it had.
      await waitFor(() => expect(shown()).toBe("2"));
      expect(seen).toHaveLength(2);
      expect(alive(seen[0]!)).toBe(false);
      expect(alive(seen[1]!)).toBe(true);
    });

    it("recreates a dropped grid on its next use", async () => {
      let state!: WasmState;
      let show!: (on: boolean) => void;
      function Toggle() {
        const [on, setOn] = useState(true);
        show = setOn;
        return on ? (
          <>
            <Count />
            <Adder />
          </>
        ) : null;
      }

      render(
        <Provider urls={URLS}>
          <Controls onState={(s) => (state = s)} />
          <Toggle />
        </Provider>
      );
      await waitFor(() => expect(shown()).toBe("2"));
      await act(async () => screen.getByTestId("add").click());
      await waitFor(() => expect(shown()).toBe("3"));

      await act(async () => show(false));
      await act(async () => state.drop(Basket));
      await act(async () => show(true));
      await waitFor(() => expect(shown()).toBe("2"));
    });

    it("reports two different definitions under one key as schema_mismatch", async () => {
      const Other = defineDataGrid("basket", defineSchema({ item: "string" }));
      render(
        <Provider urls={URLS}>
          <Count id="first" />
          <Count id="second" def={Other as unknown as DataGridDef<Schema>} />
        </Provider>
      );
      await waitFor(() => expect(shown("second")).toBe("schema_mismatch"));
      // The one that got there first is untouched.
      await waitFor(() => expect(shown("first")).toBe("2"));
    });

    it("lets shape-identical definitions share a key", async () => {
      const Same = defineDataGrid("basket", defineSchema({ item: "string", qty: "i32" }));
      const seen = new Set<AnyDataGridStore<Schema>>();
      render(
        <Provider urls={URLS}>
          <Count id="a" onGrid={(g) => seen.add(g)} />
          <Count id="b" def={Same} onGrid={(g) => seen.add(g)} />
        </Provider>
      );
      await waitFor(() => expect(shown("b")).toBe("2"));
      expect(seen.size).toBe(1);
    });

    it("names the provider a definition needs when there is none", async () => {
      let error: Error | null = null;
      function Orphan() {
        const result = useGrid(Basket);
        if (result.status === "error") error = result.error;
        return <p data-testid="state">{result.status}</p>;
      }
      render(<Orphan />);

      // Through status, on the first render: nothing is ever going to load.
      expect(shown("state")).toBe("error");
      expect(error).toBeInstanceOf(WasmStateError);
      expect((error as unknown as WasmStateError).code).toBe("no_provider");
      expect(error!.message).toContain(mode.provider);
      expect(error!.message).toContain('"basket"');
    });

    it("disposes its grids when it unmounts", async () => {
      let grid!: AnyDataGridStore<Schema>;
      const { unmount } = render(
        <Provider urls={URLS}>
          <Count onGrid={(g) => (grid = g)} />
        </Provider>
      );
      await waitFor(() => expect(shown()).toBe("2"));

      unmount();
      // Disposal waits a microtask, so StrictMode's back-to-back unmount
      // and remount never reach it.
      await act(async () => {});
      expect(alive(grid)).toBe(false);
    });

    it("throws from drop with no provider above", () => {
      let state!: WasmState;
      render(<Controls onState={(s) => (state = s)} />);
      expect(() => state.drop(Basket)).toThrowError(mode.provider);
    });
  });

  describe(`${mode.name}: under StrictMode`, () => {
    it("makes one engine and one grid, and inserts the initial rows once", async () => {
      const made = instantiations();
      const seen = new Set<AnyDataGridStore<Schema>>();
      render(
        <StrictMode>
          <Provider urls={URLS}>
            <Count id="a" onGrid={(g) => seen.add(g)} />
            <Count id="b" onGrid={(g) => seen.add(g)} />
          </Provider>
        </StrictMode>
      );
      await waitFor(() => expect(shown("a")).toBe("2"));
      expect(shown("b")).toBe("2");

      expect(made).toHaveBeenCalledTimes(1);
      expect(seen.size).toBe(1);
      const [grid] = [...seen];
      // Tombstones included: nothing was inserted and then deleted.
      expect(grid!.totalRows).toBe(2);
      expect(alive(grid!)).toBe(true);
    });
  });
}

describe("both providers, nested", () => {
  it("each holds its own grid, and neither reads the other", async () => {
    const grids: Record<string, AnyDataGridStore<Schema>> = {};

    function Sync() {
      const { grid } = useWasmDataGridSync(Basket);
      if (grid) grids.sync = grid;
      return <p data-testid="sync">{useDataGridStats(grid)?.rowCount ?? "loading"}</p>;
    }
    function Async() {
      const { grid } = useWasmDataGridAsync(Basket);
      if (grid) grids.async = grid;
      return <p data-testid="async">{useDataGridStats(grid)?.rowCount ?? "loading"}</p>;
    }

    render(
      <WasmStateSyncProvider urls={URLS}>
        <WasmStateAsyncProvider urls={URLS}>
          <Sync />
          <Async />
        </WasmStateAsyncProvider>
      </WasmStateSyncProvider>
    );

    await waitFor(() => expect(screen.getByTestId("sync").textContent).toBe("2"));
    await waitFor(() => expect(screen.getByTestId("async").textContent).toBe("2"));
    expect(grids.sync).not.toBe(grids.async);

    // The sync grid answers on the line; the async one with a Promise.
    let added: unknown;
    act(() => {
      added = grids.sync!.insertRows([{ item: "Mouse", qty: 1 }]);
    });
    expect(added).not.toBeInstanceOf(Promise);
    expect(grids.sync!.rowCount).toBe(3);
    expect(grids.async!.insertRows([])).toBeInstanceOf(Promise);
    expect(grids.async!.rowCount).toBe(2);
  });

  it("reads the right provider from either nesting order", async () => {
    function Both() {
      const sync = useWasmDataGridSync(Basket);
      const async = useWasmDataGridAsync(Basket);
      return (
        <p data-testid="both">
          {sync.status}/{async.status}
        </p>
      );
    }

    render(
      <WasmStateAsyncProvider urls={URLS}>
        <WasmStateSyncProvider urls={URLS}>
          <Both />
        </WasmStateSyncProvider>
      </WasmStateAsyncProvider>
    );
    await waitFor(() => expect(screen.getByTestId("both").textContent).toBe("ready/ready"));
  });
});

describe("urls", () => {
  it("warns once about a key that names no loaded pattern", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const typo = { datagird: { wasmUrl: ENGINE_URL } };
    render(
      <>
        <WasmStateSyncProvider urls={typo} />
        <WasmStateAsyncProvider urls={typo} />
      </>
    );
    // Once for the page, not once per provider that repeats it.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('"datagird"');
    expect(warn.mock.calls[0]![0]).toContain('"datagrid"');
  });

  it("stays quiet for a pattern that is loaded", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<WasmStateSyncProvider urls={URLS} />);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("mode", () => {
  it("is the provider's: a sync hook does not use an async provider", () => {
    let error: Error | null = null;
    function Wrong() {
      const result = useWasmDataGridSync(Basket);
      if (result.status === "error") error = result.error;
      return null;
    }
    render(
      <WasmStateAsyncProvider urls={URLS}>
        <Wrong />
      </WasmStateAsyncProvider>
    );
    expect(error!.message).toContain("WasmStateSyncProvider");
  });
});
