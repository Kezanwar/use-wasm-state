/**
 * The names of the patterns this page has loaded.
 *
 * Each pattern registers itself when its entry point is imported, so a
 * provider can tell a `urls` key that names a real pattern from a typo
 * without the root importing any of them. Kept under a global key for the
 * same reason as the contexts: every entry is its own bundle.
 */

const KEY = Symbol.for("use-wasm-state/patterns");

function names(): Set<string> {
  const store = globalThis as Record<symbol, Set<string> | undefined>;
  return (store[KEY] ??= new Set());
}

export function registerPattern(name: string): void {
  names().add(name);
}

export function registeredPatterns(): ReadonlySet<string> {
  return names();
}
