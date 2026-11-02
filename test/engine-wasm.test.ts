import { describe, expect, it } from "vitest";
import { engineWasmBytes } from "./helpers/wat";

/**
 * Guards the committed src/wasm/engine.wasm.
 *
 * Empty of logic for now, so this only checks the shape the whole design
 * rests on: a reactor module that imports nothing. The per-export tests
 * arrive with the ABI in build step 4 (test/abi.test.ts).
 */

describe("src/wasm/engine.wasm", () => {
  it("imports nothing at all", async () => {
    // -target=wasm-unknown has no WASI runtime. Any import here means the
    // build dropped off that target, and the module would then need a host
    // shim in every environment it runs in.
    const module = await WebAssembly.compile(await engineWasmBytes());
    expect(WebAssembly.Module.imports(module)).toEqual([]);
  });

  it("exports an _initialize, which is why the loader calls it", async () => {
    const { instance } = await WebAssembly.instantiate(await engineWasmBytes(), {});
    expect(typeof instance.exports._initialize).toBe("function");
  });

  it("exports memory", async () => {
    const { instance } = await WebAssembly.instantiate(await engineWasmBytes(), {});
    expect(instance.exports.memory).toBeInstanceOf(WebAssembly.Memory);
  });
});
