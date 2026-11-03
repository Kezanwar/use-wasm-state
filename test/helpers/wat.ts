import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import wabtInit from "wabt";

type Wabt = Awaited<ReturnType<typeof wabtInit>>;

let wabt: Promise<Wabt> | null = null;

// Paths are resolved from the project root rather than import.meta.url:
// under the jsdom environment Vitest serves modules over http, so
// import.meta.url is not a file: URL there.
const root = process.cwd();

/**
 * Compiles a .wat fixture to wasm bytes. Fixtures are kept as text so they
 * stay reviewable; no binaries are committed for the tests.
 */
export async function watToWasm(name: string): Promise<Uint8Array<ArrayBuffer>> {
  wabt ??= wabtInit();
  const source = await readFile(resolve(root, "test/fixtures", `${name}.wat`), "utf8");
  const parsed = (await wabt).parseWat(`${name}.wat`, source);
  try {
    // Copied into a plain ArrayBuffer-backed view: BufferSource (and so
    // WebAssembly.compile) rejects the ArrayBufferLike-backed type.
    return Uint8Array.from(parsed.toBinary({}).buffer);
  } finally {
    parsed.destroy();
  }
}

/** The committed engine build. Present without TinyGo installed. */
export const ENGINE_WASM_PATH = resolve(root, "src/datagrid/datagrid.wasm");

export async function engineWasmBytes(): Promise<Uint8Array<ArrayBuffer>> {
  return Uint8Array.from(await readFile(ENGINE_WASM_PATH));
}
