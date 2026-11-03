/**
 * The providers: one per mode, each owning one registry.
 *
 * Neither knows what it holds. A definition says which engine it needs and
 * how to make its state; the provider loads that engine the first time it
 * is asked, keeps it until it unmounts, and keeps each instance by key.
 * Nesting a sync and an async provider just works, because they are two
 * contexts that never read each other.
 */

import { useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Mode, WasmStateDef } from "./contract";
import { contextFor, noProviderError } from "./context";
import { registeredPatterns } from "./patterns";
import { createRegistry, type Registry, type UrlOverrides } from "./registry";

export interface WasmStateSyncProviderProps {
  /**
   * Where each pattern's engine is fetched from, keyed by the pattern's
   * name. Each defaults to the copy shipped beside its bundle. Read once,
   * when the provider mounts.
   */
  urls?: Readonly<Record<string, { wasmUrl?: string | URL }>>;
  children?: ReactNode;
}

export interface WasmStateAsyncProviderProps {
  /** As for the sync provider, plus where each pattern's worker comes from. */
  urls?: Readonly<Record<string, { wasmUrl?: string | URL; workerUrl?: string | URL }>>;
  children?: ReactNode;
}

/** What a component can do with the provider above it. */
export interface WasmState {
  /**
   * Dispose a shared instance. Its next use creates it afresh, initial
   * rows and all, and anything still showing it is handed the new one.
   */
  drop(def: WasmStateDef): void;
}

/** Holds shared state on the main thread. Reads happen during render. */
export function WasmStateSyncProvider({ urls, children }: WasmStateSyncProviderProps) {
  return <Owner mode="sync" urls={urls} children={children} />;
}

/** Holds shared state in a worker per pattern. Mutations return Promises. */
export function WasmStateAsyncProvider({ urls, children }: WasmStateAsyncProviderProps) {
  return <Owner mode="async" urls={urls} children={children} />;
}

/** The sync provider above this component. */
export function useWasmStateSync(): WasmState {
  return useControls("sync");
}

/** The async provider above this component. */
export function useWasmStateAsync(): WasmState {
  return useControls("async");
}

function Owner({
  mode,
  urls,
  children,
}: {
  mode: Mode;
  urls: WasmStateAsyncProviderProps["urls"];
  children?: ReactNode;
}) {
  // Nothing is loaded here: a registry is a few empty maps until a hook
  // asks it for something. Which also means the server can render this.
  const [registry] = useState(() => createRegistry(mode, normalize(urls)));

  useEffect(() => {
    registry.retain();
    return () => registry.release();
  }, [registry]);

  // After mount, when the entries its children import have registered.
  const [keys] = useState(() => Object.keys(urls ?? {}));
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") warnUnknownPatterns(mode, keys);
  }, [mode, keys]);

  const Context = contextFor(mode);
  return <Context.Provider value={registry}>{children}</Context.Provider>;
}

function useControls(mode: Mode): WasmState {
  const registry = useContext(contextFor(mode));
  return useMemo(() => controls(registry, mode), [registry, mode]);
}

function controls(registry: Registry | null, mode: Mode): WasmState {
  return {
    drop(def) {
      if (!registry) throw noProviderError(mode, def.key);
      registry.drop(def);
    },
  };
}

/** Each unknown name once per page, however many providers repeat it. */
const warned = new Set<string>();

/**
 * A `urls` key that names no loaded pattern is ignored, which a typo would
 * otherwise be in silence: the engine would quietly load from its default.
 */
function warnUnknownPatterns(mode: Mode, keys: readonly string[]) {
  const known = registeredPatterns();
  for (const key of keys) {
    if (known.has(key) || warned.has(key)) continue;
    warned.add(key);
    const provider = mode === "sync" ? "WasmStateSyncProvider" : "WasmStateAsyncProvider";
    console.warn(
      `use-wasm-state: <${provider} urls> names "${key}", which is not a pattern this page has ` +
        `loaded, so it is ignored. Loaded: ${[...known].map((n) => `"${n}"`).join(", ") || "none"}.`
    );
  }
}

/** URLs as strings, so an inline `new URL(...)` compares by address. */
function normalize(urls: WasmStateAsyncProviderProps["urls"]): UrlOverrides {
  const out: Record<string, { wasmUrl?: string; workerUrl?: string }> = {};
  for (const [name, entry] of Object.entries(urls ?? {})) {
    out[name] = {
      wasmUrl: entry.wasmUrl === undefined ? undefined : String(entry.wasmUrl),
      workerUrl: entry.workerUrl === undefined ? undefined : String(entry.workerUrl),
    };
  }
  return out;
}
