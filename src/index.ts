/**
 * use-wasm-state: what every state pattern shares.
 *
 * The providers, the error type and the shapes common to all of them.
 * Nothing here knows what any one pattern is: each lives in its own entry
 * point and brings its own engine.
 */

export {
  useWasmStateAsync,
  useWasmStateSync,
  WasmStateAsyncProvider,
  WasmStateSyncProvider,
} from "./core/providers";
export type {
  WasmState,
  WasmStateAsyncProviderProps,
  WasmStateSyncProviderProps,
} from "./core/providers";
export type { WasmStateDef } from "./core/contract";

export { WasmStateError } from "./core/errors";
export type { WasmStateErrorCode } from "./core/errors";
