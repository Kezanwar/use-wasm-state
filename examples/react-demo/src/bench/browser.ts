/**
 * The benchmark in this browser: the runner the published figures came
 * from, given this page's copy of the engine and a pause between samples
 * so the page keeps painting while it works.
 */

import wasmUrl from "use-wasm-state/datagrid.wasm?url";
import { implementations } from "./implementations";
import { runBenchmarks, type Results } from "./runner";

/** One macrotask, which is enough for a paint and an input event. */
const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export function runInBrowser(
  onProgress: (done: number, total: number, label: string) => void,
  options: { rows?: number; repeats?: number } = {}
): Promise<Results> {
  return runBenchmarks(implementations(new URL(wasmUrl, location.href).href), {
    rows: options.rows,
    repeats: options.repeats ?? 7,
    pause,
    onProgress,
  });
}
