/**
 * What a provider holds: one engine per pattern, one instance per key.
 *
 * Engines are loaded the first time a definition of their pattern is used,
 * so a provider only ever fetches the engines something actually uses.
 * Instances live as long as the registry. Nothing is reference-counted:
 * a shared instance outlives every component that used it, which is the
 * point of sharing it.
 *
 * Plain objects, no React: the provider owns one of these and the hooks
 * call into it from their effects.
 */

import type { Disposable, EngineUrls, Mode, Pattern, StateDef, WasmStateDef } from "./contract";
import { disposedError, WasmStateError } from "./errors";

/** Per-pattern overrides for where an engine is fetched from, keyed by pattern name. */
export type UrlOverrides = Readonly<Record<string, EngineUrls>>;

export interface Registry {
  readonly mode: Mode;
  /** The instance for this definition, created on first use. */
  acquire(def: StateDef): Promise<Disposable>;
  /** Dispose this definition's instance. The next acquire creates it afresh. */
  drop(def: WasmStateDef): void;
  /** Called when a key is dropped, so whoever is showing it can ask again. */
  onDrop(key: string, listener: () => void): () => void;
  /**
   * Hold the registry open. Paired with release; disposal waits a
   * microtask, so StrictMode's simulated unmount and remount, which happen
   * back to back, never get as far as disposing anything.
   */
  retain(): void;
  release(): void;
}

interface Entry {
  def: StateDef;
  instance: Promise<Disposable>;
}

export function createRegistry(mode: Mode, urls: UrlOverrides = {}): Registry {
  const engines = new Map<Pattern, Promise<Disposable>>();
  const entries = new Map<string, Entry>();
  const dropListeners = new Map<string, Set<() => void>>();

  let disposed = false;
  let holders = 0;
  let pendingRelease = false;

  const engineFor = (pattern: Pattern) => {
    let engine = engines.get(pattern);
    if (!engine) {
      const overrides = urls[pattern.name] ?? {};
      engine = mode === "sync" ? pattern.loadSync(overrides) : pattern.loadAsync(overrides);
      engines.set(pattern, engine);
      // A failed load is forgotten, so the next use tries again rather than
      // replaying the same failure for the life of the provider.
      engine.catch(() => {
        if (engines.get(pattern) === engine) engines.delete(pattern);
      });
    }
    return engine;
  };

  const dispose = () => {
    disposed = true;
    for (const entry of entries.values()) void entry.instance.then(release, ignore);
    for (const engine of engines.values()) void engine.then(release, ignore);
    entries.clear();
    engines.clear();
    dropListeners.clear();
  };

  return {
    mode,

    acquire(def) {
      if (disposed) return Promise.reject(disposedError("acquire", "provider"));

      const held = entries.get(def.key);
      if (held) {
        if (held.def !== def && held.def.shape !== def.shape) {
          return Promise.reject(
            new WasmStateError(
              "schema_mismatch",
              0,
              def.key,
              `use-wasm-state: two definitions share the key "${def.key}" but not their shape. ` +
                `Give one of them another key.`
            )
          );
        }
        return held.instance;
      }

      const recipe = mode === "sync" ? def.sync : def.async;
      const instance = engineFor(def.pattern).then((engine) => recipe.create(engine as never));
      const entry: Entry = { def, instance };
      entries.set(def.key, entry);

      // A failed create is forgotten too. Disposal needs nothing here:
      // drop and dispose both chain a release onto this promise, so an
      // instance that lands after either is released the moment it does.
      instance.catch(() => {
        if (entries.get(def.key) === entry) entries.delete(def.key);
      });
      return instance;
    },

    drop(def) {
      const held = entries.get(def.key);
      if (!held) return;
      entries.delete(def.key);
      void held.instance.then(release, ignore);
      for (const listener of dropListeners.get(def.key) ?? []) listener();
    },

    onDrop(key, listener) {
      let set = dropListeners.get(key);
      if (!set) dropListeners.set(key, (set = new Set()));
      set.add(listener);
      return () => void set.delete(listener);
    },

    retain() {
      holders++;
    },

    release() {
      holders--;
      if (pendingRelease) return;
      pendingRelease = true;
      queueMicrotask(() => {
        pendingRelease = false;
        if (holders <= 0 && !disposed) dispose();
      });
    },
  };
}

/**
 * Instances are released before their engines, but one still being made
 * can land after its engine has gone. Disposal is idempotent and allowed
 * to find the engine gone, so a late one is released quietly.
 */
const release = (value: Disposable) => {
  try {
    value.dispose();
  } catch {
    // Already gone with its engine.
  }
};
const ignore = () => {};
