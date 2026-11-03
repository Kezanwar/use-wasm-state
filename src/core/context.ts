/**
 * The two provider contexts, one per mode.
 *
 * Created once per page under a global key rather than once per module.
 * Every entry point is a self-contained bundle, so the root and each
 * pattern's entry carry their own copy of this file; two calls to
 * createContext would give a pattern's hook a different context from the
 * one the provider fills, and every shared definition would report that
 * its provider is missing.
 */

import { createContext, type Context } from "react";
import type { Mode } from "./contract";
import { WasmStateError } from "./errors";
import type { Registry } from "./registry";

const KEYS: Record<Mode, symbol> = {
  sync: Symbol.for("use-wasm-state/sync-provider"),
  async: Symbol.for("use-wasm-state/async-provider"),
};

/** The component a shared definition needs above it, by mode. */
const PROVIDER_NAMES: Record<Mode, string> = {
  sync: "WasmStateSyncProvider",
  async: "WasmStateAsyncProvider",
};

export function contextFor(mode: Mode): Context<Registry | null> {
  const store = globalThis as Record<symbol, Context<Registry | null> | undefined>;
  return (store[KEYS[mode]] ??= createContext<Registry | null>(null));
}

/** A shared definition used with no provider of its mode above it. */
export function noProviderError(mode: Mode, key: string): WasmStateError {
  return new WasmStateError(
    "no_provider",
    0,
    key,
    `use-wasm-state: "${key}" is a shared definition and needs a <${PROVIDER_NAMES[mode]}> above it`
  );
}
