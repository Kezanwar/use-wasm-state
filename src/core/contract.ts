/**
 * The contract between a provider and a state pattern.
 *
 * A provider knows nothing about what it holds.
 * A definition carries everything needed to make its state: which engine it
 * runs on, how to load that engine in each mode, and how to create an
 * instance in it. The provider keeps one engine per pattern and one
 * instance per key, and that is all it does.
 *
 * Internal. Only `WasmStateDef`, the part a caller can see, is exported.
 */

/** Which provider, and so which thread the engine runs on. */
export type Mode = "sync" | "async";

/**
 * Anything a provider has to release. Engines and instances both are.
 *
 * Must be safe to call twice, and on an instance whose engine has already
 * gone: a provider unmounting releases both, and cannot always order them.
 */
export interface Disposable {
  dispose(): void;
}

/** Where a pattern's engine is fetched from. Each defaults beside its bundle. */
export interface EngineUrls {
  wasmUrl?: string;
  /** Async only. */
  workerUrl?: string;
}

/**
 * One kind of state, and the engine it needs.
 *
 * `name` keys the engine inside a provider and the provider's `urls`
 * overrides, so a pattern is identified the same way in both places.
 */
export interface Pattern<
  SyncEngine extends Disposable = Disposable,
  AsyncEngine extends Disposable = Disposable,
> {
  readonly name: string;
  loadSync(urls: EngineUrls): Promise<SyncEngine>;
  loadAsync(urls: EngineUrls): Promise<AsyncEngine>;
}

/** How a definition's state is made in one mode. */
export interface Recipe<E, I extends Disposable> {
  /** Create the instance, initial data and all. Runs once per provider. */
  create(engine: E): I | Promise<I>;
}

/**
 * A shared definition, as a caller holds it.
 *
 * The rest of the contract is on the same object, but deliberately not in
 * this type: a caller names a definition, and never builds one by hand.
 */
export interface WasmStateDef {
  readonly key: string;
}

/** A definition, contract included. */
export interface StateDef<
  SyncI extends Disposable = Disposable,
  AsyncI extends Disposable = Disposable,
> extends WasmStateDef {
  readonly pattern: Pattern;
  /**
   * What the state looks like, as a string. Two definitions may share a
   * key only when these are equal, so it includes the pattern's name.
   */
  readonly shape: string;
  readonly sync: Recipe<never, SyncI>;
  readonly async: Recipe<never, AsyncI>;
}
