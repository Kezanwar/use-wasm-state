// @vitest-environment jsdom
import { StrictMode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WasmStateAsyncProvider, WasmStateError, WasmStateSyncProvider } from "../../src/index";
import type { Mode, Pattern, StateDef } from "../../src/core/contract";
import { registerPattern } from "../../src/core/patterns";
import { useSharedState } from "../../src/core/state";
import {
  defineDataGrid,
  defineSchema,
  useDataGridStats,
  useWasmDataGridAsync,
  useWasmDataGridSync,
} from "../../src/datagrid/index";
import { ENGINE_URL, serveEngine } from "../helpers/engine";
import { stubWorker } from "../helpers/fake-worker";

/**
 * The providers know nothing about grids.
 *
 * A pattern that exists only in this file, with a fake engine and its own
 * definitions, lives under the same provider as a real datagrid. Each gets
 * an engine of its own, and nothing in the provider had to change to allow
 * it. A future sheet arrives the same way.
 */

/** The fake pattern's instance: a number that counts. */
class Counter {
  value = 0;
  disposed = false;
  dispose() {
    this.disposed = true;
  }
}

/** Every fake engine and instance made, so a test can count them. */
const made = { engines: [] as { mode: Mode; urls: unknown; disposed: boolean }[], counters: 0 };

const counting: Pattern = {
  name: "counter",
  async loadSync(urls) {
    const engine = { mode: "sync" as Mode, urls, disposed: false, dispose: () => {} };
    engine.dispose = () => void (engine.disposed = true);
    made.engines.push(engine);
    return engine;
  },
  async loadAsync(urls) {
    const engine = { mode: "async" as Mode, urls, disposed: false, dispose: () => {} };
    engine.dispose = () => void (engine.disposed = true);
    made.engines.push(engine);
    return engine;
  },
};

// What a pattern's entry does on import, so a provider knows its name.
registerPattern(counting.name);

function defineCounter(key: string, start: number): StateDef<Counter, Counter> {
  const create = () => {
    made.counters++;
    const counter = new Counter();
    counter.value = start;
    return counter;
  };
  return { key, pattern: counting, shape: "counter", sync: { create }, async: { create } };
}

const Clicks = defineCounter("clicks", 7);

/** What a pattern's hook is, minus everything a real pattern would add. */
function CounterView({ mode, def = Clicks }: { mode: Mode; def?: StateDef }) {
  const state = useSharedState<Counter>(mode, def);
  const text =
    state.status === "ready"
      ? String(state.value.value)
      : state.status === "error"
        ? (state.error as WasmStateError).code
        : "loading";
  return <p data-testid="counter">{text}</p>;
}

const schema = defineSchema({ item: "string" });
const Items = defineDataGrid("items", schema, { initialRows: [{ item: "a" }] });

function SyncGrid() {
  const { grid } = useWasmDataGridSync(Items);
  return <p data-testid="grid">{useDataGridStats(grid)?.rowCount ?? "loading"}</p>;
}

function AsyncGrid() {
  const { grid } = useWasmDataGridAsync(Items);
  return <p data-testid="grid">{useDataGridStats(grid)?.rowCount ?? "loading"}</p>;
}

const GridView = ({ mode }: { mode: Mode }) => (mode === "sync" ? <SyncGrid /> : <AsyncGrid />);

beforeAll(() => {
  serveEngine();
  stubWorker();
});
afterAll(() => vi.unstubAllGlobals());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  made.engines.length = 0;
  made.counters = 0;
});

const PROVIDERS = { sync: WasmStateSyncProvider, async: WasmStateAsyncProvider } as const;

for (const mode of ["sync", "async"] as const) {
  const Provider = PROVIDERS[mode];
  const urls = { datagrid: { wasmUrl: ENGINE_URL }, counter: { wasmUrl: "https://counter.test" } };

  describe(`${mode}: a second pattern beside a datagrid`, () => {
    it("gets an engine of its own, loaded in the provider's mode", async () => {
      render(
        <StrictMode>
          <Provider urls={urls}>
            <GridView mode={mode} />
            <CounterView mode={mode} />
            <CounterView mode={mode} />
          </Provider>
        </StrictMode>
      );

      await waitFor(() => expect(screen.getAllByTestId("counter")[1]!.textContent).toBe("7"));
      await waitFor(() => expect(screen.getByTestId("grid").textContent).toBe("1"));

      // One fake engine and one counter, under StrictMode, for two users.
      expect(made.engines).toHaveLength(1);
      expect(made.engines[0]!.mode).toBe(mode);
      expect(made.counters).toBe(1);
      // Its own overrides, by pattern name, and none of the datagrid's.
      expect(made.engines[0]!.urls).toMatchObject({ wasmUrl: "https://counter.test" });
    });

    it("is loaded only when something asks for it", async () => {
      render(
        <Provider urls={urls}>
          <GridView mode={mode} />
        </Provider>
      );
      await waitFor(() => expect(screen.getByTestId("grid").textContent).toBe("1"));
      expect(made.engines).toHaveLength(0);
    });

    it("cannot share a key with a different pattern", async () => {
      const Clash = defineCounter("items", 0);
      render(
        <Provider urls={urls}>
          <GridView mode={mode} />
          <CounterView mode={mode} def={Clash} />
        </Provider>
      );
      await waitFor(() =>
        expect(screen.getByTestId("counter").textContent).toBe("schema_mismatch")
      );
    });

    it("is disposed with the provider, engine and all", async () => {
      const { unmount } = render(
        <Provider urls={urls}>
          <CounterView mode={mode} />
        </Provider>
      );
      await waitFor(() => expect(screen.getByTestId("counter").textContent).toBe("7"));
      unmount();
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(made.engines[0]!.disposed).toBe(true);
    });
  });
}
