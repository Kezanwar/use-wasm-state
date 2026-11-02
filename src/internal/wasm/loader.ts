/**
 * Copied from react-use-wasm src/use-wasm.ts.
 * Keep in sync until extracted to a shared core.
 *
 * Only the module-loading half came across: the compiled-module cache, the
 * compileStreaming fallback and the reactor `_initialize` call. The hook,
 * its state union and its typed `call` helper stayed behind — this layer is
 * framework-agnostic and knows nothing about React.
 */

/**
 * One compiled module per URL, shared by every consumer.
 *
 * Compiling is the expensive part and a `WebAssembly.Module` is immutable
 * and structured-cloneable, so the same one can be instantiated repeatedly
 * and posted to a worker. Instances are never cached: each gets its own
 * linear memory, which is the whole point of a per-engine instance.
 */
const moduleCache = new Map<string, Promise<WebAssembly.Module>>();

async function compileFromUrl(
  url: string,
  init?: RequestInit,
  signal?: AbortSignal
): Promise<WebAssembly.Module> {
  const res = await fetch(url, { ...init, signal });
  if (!res.ok) {
    throw new Error(`use-wasm-state: failed to fetch ${url} (${res.status} ${res.statusText})`);
  }
  // Streaming compile needs the server to send `Content-Type: application/wasm`.
  const isWasmMime = res.headers.get("content-type")?.includes("application/wasm");
  if (isWasmMime && typeof WebAssembly.compileStreaming === "function") {
    return WebAssembly.compileStreaming(res);
  }
  return WebAssembly.compile(await res.arrayBuffer());
}

/** Fetch + compile, cached per URL unless `useCache` is false. */
export function loadModule(
  url: string,
  init?: RequestInit,
  useCache = true,
  signal?: AbortSignal
): Promise<WebAssembly.Module> {
  if (!useCache) return compileFromUrl(url, init, signal);

  let pending = moduleCache.get(url);
  if (!pending) {
    // Not tied to one caller's AbortSignal, since others may share it.
    pending = compileFromUrl(url, init);
    moduleCache.set(url, pending);
    pending.catch(() => moduleCache.delete(url)); // allow retry after failure
  }
  return pending;
}

/** Remove a URL (or everything) from the compiled-module cache. */
export function clearWasmCache(url?: string): void {
  if (url) moduleCache.delete(url);
  else moduleCache.clear();
}

/**
 * WASI "reactor" convention. Modules built as libraries rather than commands
 * (TinyGo's wasm targets, wasi-libc reactors) export `_initialize` and need
 * it run once before any other export is touched. TinyGo's exports trap
 * otherwise, so this runs before an instance is ever handed out.
 */
export function runReactorInit(exports: WebAssembly.Exports): void {
  const init = exports._initialize;
  if (typeof init === "function") (init as () => void)();
}

/**
 * Fetch, compile and instantiate in one go, with `_initialize` already run.
 *
 * The convenience wrapper the engine clients use. Reaching for `loadModule`
 * directly only makes sense when the compiled module itself is wanted, e.g.
 * to post it to a worker.
 */
export async function instantiateModule(
  url: string,
  options: {
    imports?: WebAssembly.Imports;
    cache?: boolean;
    fetchInit?: RequestInit;
    signal?: AbortSignal;
  } = {}
): Promise<WebAssembly.Instance> {
  const { imports = {}, cache = true, fetchInit, signal } = options;
  const module = await loadModule(url, fetchInit, cache, signal);
  const instance = await WebAssembly.instantiate(module, imports);
  // Before the instance escapes, so the first call never hits an
  // uninitialised module.
  runReactorInit(instance.exports);
  return instance;
}
