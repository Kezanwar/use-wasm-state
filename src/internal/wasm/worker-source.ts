/**
 * Copied from react-use-wasm src/use-wasm-worker.ts.
 * Keep in sync until extracted to a shared core.
 *
 * Only the worker bootstrap came across: the source string, the Blob URL and
 * the `workerUrl` CSP fallback. The hook that drives it stayed behind.
 *
 * The protocol here is still react-use-wasm's generic "call an export by
 * name" RPC. use-wasm-state's own protocol (engine handles, revisions,
 * transferred column buffers) is built on top of this bootstrap in build
 * step 8; see src/engine/protocol.ts when it lands.
 */

/**
 * Source of the worker. It's inlined as a Blob URL so no bundler config is
 * needed. Under a strict CSP that blocks `blob:` workers, save this string
 * as a .js file, serve it yourself and pass its URL as `workerUrl`.
 */
export const WASM_WORKER_SOURCE = `
let wasmExports = null;

const serialize = (err) => ({
  name: (err && err.name) || "Error",
  message: (err && err.message) || String(err),
  stack: err && err.stack,
});

self.onmessage = async (event) => {
  const msg = event.data;

  if (msg.type === "init") {
    try {
      let imports = {};
      if (msg.importsUrl) {
        const mod = await import(msg.importsUrl);
        const provided = mod.default ?? mod.imports ?? {};
        imports = typeof provided === "function" ? await provided() : provided;
      }
      const instance = await WebAssembly.instantiate(msg.module, imports);
      wasmExports = instance.exports;
      // WASI "reactor" convention: run _initialize once before reporting ready.
      if (typeof wasmExports._initialize === "function") {
        wasmExports._initialize();
      }
      self.postMessage({ type: "ready" });
    } catch (err) {
      self.postMessage({ type: "init-error", error: serialize(err) });
    }
    return;
  }

  if (msg.type === "call") {
    try {
      const fn = wasmExports && wasmExports[msg.name];
      if (typeof fn !== "function") {
        throw new Error('export "' + msg.name + '" is not a function');
      }
      const result = await fn(...msg.args);
      self.postMessage({ type: "result", id: msg.id, result });
    } catch (err) {
      self.postMessage({ type: "error", id: msg.id, error: serialize(err) });
    }
  }
};
`;

let blobWorkerUrl: string | null = null;

/**
 * URL of the bootstrap worker, created once and reused.
 *
 * A Blob URL rather than a separate bundled file, so the package works in
 * any bundler with no config. Pass your own `workerUrl` where a CSP blocks
 * `blob:` workers: serve {@link WASM_WORKER_SOURCE} as a .js file and point
 * at that instead.
 */
export function defaultWorkerUrl(): string {
  blobWorkerUrl ??= URL.createObjectURL(
    new Blob([WASM_WORKER_SOURCE], { type: "text/javascript" })
  );
  return blobWorkerUrl;
}

/** Resolve the worker URL to use: the caller's override, or the Blob URL. */
export function resolveWorkerUrl(workerUrl?: string): string {
  return workerUrl ?? defaultWorkerUrl();
}
