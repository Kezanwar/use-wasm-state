import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearWasmCache,
  instantiateModule,
  loadModule,
  runReactorInit,
} from "../../src/internal/wasm/loader";
import { watToWasm } from "../helpers/wat";

/**
 * The loader, reached directly rather than through a hook, with `fetch`
 * stubbed. Everything worth checking here is invisible from above: that the
 * compiled-module cache really is a cache, that the streaming fallback
 * fires on the wrong MIME type, and that each instance gets its own memory.
 */

const URL_A = "https://example.test/a.wasm";
const URL_B = "https://example.test/b.wasm";

let fetches: string[] = [];

/** Serves a fixture, recording every request so cache hits are countable. */
function serve(fixture: string, { contentType = "application/wasm", status = 200 } = {}) {
  const stub = vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    fetches.push(String(input));
    const bytes = await watToWasm(fixture);
    return new Response(status === 200 ? bytes : null, {
      status,
      statusText: status === 200 ? "OK" : "Not Found",
      headers: contentType ? { "content-type": contentType } : {},
    });
  });
  vi.stubGlobal("fetch", stub);
  return stub;
}

beforeEach(() => {
  fetches = [];
  clearWasmCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clearWasmCache();
});

describe("loadModule", () => {
  it("fetches and compiles a module", async () => {
    serve("math");
    const mod = await loadModule(URL_A);
    expect(mod).toBeInstanceOf(WebAssembly.Module);
    expect(WebAssembly.Module.exports(mod).map((e) => e.name)).toContain("fib");
  });

  it("compiles each URL once and hands the same module to every caller", async () => {
    serve("math");
    const [first, second] = await Promise.all([loadModule(URL_A), loadModule(URL_A)]);
    // Same module object, not just an equal one: instantiating is cheap,
    // compiling is not, and a Module is immutable so sharing is safe.
    expect(first).toBe(second);
    expect(fetches).toEqual([URL_A]);
  });

  it("keys the cache by URL", async () => {
    serve("math");
    await loadModule(URL_A);
    await loadModule(URL_B);
    expect(fetches).toEqual([URL_A, URL_B]);
  });

  it("re-fetches every time when the cache is off", async () => {
    serve("math");
    await loadModule(URL_A, undefined, false);
    await loadModule(URL_A, undefined, false);
    expect(fetches).toEqual([URL_A, URL_A]);
  });

  it("passes fetch options through", async () => {
    const stub = serve("math");
    await loadModule(URL_A, { headers: { "x-test": "1" } });
    expect(stub.mock.calls[0]![1]).toMatchObject({ headers: { "x-test": "1" } });
  });

  it("names the URL and the status when the fetch fails", async () => {
    serve("math", { status: 404 });
    await expect(loadModule(URL_A)).rejects.toThrowError(/failed to fetch .*a\.wasm \(404/);
  });

  it("drops a failed compile from the cache so a retry can succeed", async () => {
    serve("math", { status: 500 });
    await expect(loadModule(URL_A)).rejects.toThrow();

    serve("math");
    await expect(loadModule(URL_A)).resolves.toBeInstanceOf(WebAssembly.Module);
  });

  it("streams the compile when the server sends application/wasm", async () => {
    serve("math");
    const streaming = vi.spyOn(WebAssembly, "compileStreaming");
    await loadModule(URL_A);
    expect(streaming).toHaveBeenCalledOnce();
  });

  it("falls back to a buffered compile when the MIME type is wrong", async () => {
    // The usual cause is a static host serving .wasm as octet-stream;
    // compileStreaming rejects outright there, so the fallback is not
    // optional.
    serve("math", { contentType: "application/octet-stream" });
    const streaming = vi.spyOn(WebAssembly, "compileStreaming");
    const mod = await loadModule(URL_A);
    expect(streaming).not.toHaveBeenCalled();
    expect(mod).toBeInstanceOf(WebAssembly.Module);
  });
});

describe("clearWasmCache", () => {
  it("drops one URL and leaves the rest", async () => {
    serve("math");
    await loadModule(URL_A);
    await loadModule(URL_B);

    clearWasmCache(URL_A);
    await loadModule(URL_A);
    await loadModule(URL_B);

    expect(fetches).toEqual([URL_A, URL_B, URL_A]);
  });

  it("drops everything when called with no URL", async () => {
    serve("math");
    await loadModule(URL_A);
    await loadModule(URL_B);

    clearWasmCache();
    await loadModule(URL_A);
    await loadModule(URL_B);

    expect(fetches).toEqual([URL_A, URL_B, URL_A, URL_B]);
  });
});

describe("runReactorInit", () => {
  it("calls _initialize when the module has one", async () => {
    const { instance } = await WebAssembly.instantiate(await watToWasm("reactor"), {});
    const exports = instance.exports as unknown as { initCount(): number };
    runReactorInit(instance.exports);
    expect(exports.initCount()).toBe(1);
  });

  it("does nothing for a module without one", async () => {
    const { instance } = await WebAssembly.instantiate(await watToWasm("math"), {});
    expect(() => runReactorInit(instance.exports)).not.toThrow();
  });
});

describe("instantiateModule", () => {
  it("returns an instance with _initialize already run", async () => {
    serve("reactor");
    const instance = await instantiateModule(URL_A);
    const exports = instance.exports as unknown as { initCount(): number };
    // Exactly once: TinyGo's exports trap before it and misbehave after a
    // second call, so this is the one thing the loader must get right.
    expect(exports.initCount()).toBe(1);
  });

  it("gives each instance its own linear memory from one compile", async () => {
    serve("alloc");
    const a = (await instantiateModule(URL_A)).exports as unknown as {
      alloc(n: number): number;
      memory: WebAssembly.Memory;
    };
    const b = (await instantiateModule(URL_A)).exports as unknown as {
      alloc(n: number): number;
      memory: WebAssembly.Memory;
    };

    expect(fetches).toEqual([URL_A]);
    expect(a.memory).not.toBe(b.memory);
    // Both bump allocators start from the same offset, which they could not
    // do if they shared memory.
    expect(a.alloc(16)).toBe(b.alloc(16));
  });

  it("passes imports through", async () => {
    serve("imports");
    const logged: number[] = [];
    const instance = await instantiateModule(URL_A, {
      imports: { env: { log: (x: number) => void logged.push(x) } },
    });
    const exports = instance.exports as unknown as { logSum(a: number, b: number): number };
    expect(exports.logSum(40, 2)).toBe(42);
    expect(logged).toEqual([42]);
  });

  it("surfaces a missing import as a rejection", async () => {
    serve("imports");
    await expect(instantiateModule(URL_A)).rejects.toThrow();
  });
});
