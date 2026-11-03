/**
 * The two lifecycles every pattern's hooks are built from.
 *
 * Shared: the instance belongs to the provider. The hook asks for it, and
 * if it is dropped while showing, asks again. Nothing is disposed when a
 * component unmounts.
 *
 * Private: the hook owns a whole engine with one instance in it, and
 * disposes both on unmount. StrictMode mounts twice; the first engine is
 * disposed the moment it arrives into a cancelled mount, so initial data is
 * only ever inserted into the engine that survives.
 *
 * Neither knows what the instance is. A pattern's hook calls both with
 * one of them given null, so hook order never depends on its argument.
 */

import { useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Disposable, EngineUrls, Mode, StateDef } from "./contract";
import { contextFor, noProviderError } from "./context";
import { toError } from "./errors";

export type StateResult<I> =
  | { status: "loading"; value: null; error: null }
  | { status: "ready"; value: I; error: null }
  | { status: "error"; value: null; error: Error };

const LOADING = { status: "loading", value: null, error: null } as const;

/** The instance a provider holds for `def`, or null to do nothing. */
export function useSharedState<I extends Disposable>(
  mode: Mode,
  def: StateDef | null
): StateResult<I> {
  const registry = useContext(contextFor(mode));
  const [state, setState] = useState<StateResult<I>>(LOADING);

  // Keyed on what the definition is rather than on the object, so one
  // rebuilt on every render does not ask the provider again on every one.
  const latest = useRef(def);
  latest.current = def;
  const key = def?.key;
  const shape = def?.shape;

  useEffect(() => {
    const current = latest.current;
    if (!current || !registry) return;

    let live = true;
    const load = () => {
      setState(LOADING);
      registry.acquire(current).then(
        (instance) => {
          if (live) setState({ status: "ready", value: instance as I, error: null });
        },
        (err) => {
          if (live) setState({ status: "error", value: null, error: toError(err) });
        }
      );
    };

    load();
    const off = registry.onDrop(current.key, () => {
      if (live) load();
    });
    return () => {
      live = false;
      off();
    };
  }, [registry, key, shape]);

  // Decided during render, so the server reports it too.
  const missing = useMemo<StateResult<I> | null>(
    () =>
      key !== undefined && !registry
        ? { status: "error", value: null, error: noProviderError(mode, key) }
        : null,
    [key, registry, mode]
  );

  return missing ?? state;
}

/** A private engine holding the state `def` describes, or null to do nothing. */
export function usePrivateState<I extends Disposable>(
  mode: Mode,
  def: Pick<StateDef, "pattern" | "sync" | "async"> | null,
  urls: EngineUrls
): StateResult<I> {
  const [state, setState] = useState<StateResult<I>>(LOADING);

  // Read once, on mount: a different recipe cannot migrate an instance
  // that already holds data.
  const first = useRef(def);
  if (!first.current) first.current = def;
  const active = def !== null;
  const { wasmUrl, workerUrl } = urls;

  useEffect(() => {
    const recipe = first.current;
    if (!active || !recipe) return;

    let cancelled = false;
    let engine: Disposable | null = null;
    setState(LOADING);

    (async () => {
      try {
        const loaded =
          mode === "sync"
            ? await recipe.pattern.loadSync({ wasmUrl })
            : await recipe.pattern.loadAsync({ wasmUrl, workerUrl });
        if (cancelled) {
          loaded.dispose();
          return;
        }
        engine = loaded;

        const made = mode === "sync" ? recipe.sync : recipe.async;
        const instance = await made.create(loaded as never);
        if (cancelled) {
          loaded.dispose();
          engine = null;
          return;
        }
        setState({ status: "ready", value: instance as I, error: null });
      } catch (err) {
        if (!cancelled) setState({ status: "error", value: null, error: toError(err) });
      }
    })();

    return () => {
      cancelled = true;
      engine?.dispose();
      engine = null;
    };
  }, [active, mode, wasmUrl, workerUrl]);

  return state;
}
