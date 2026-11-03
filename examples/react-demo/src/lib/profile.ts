import type { ProfilerOnRenderCallback } from "react";

/**
 * A side channel for the React Profiler.
 *
 * The grid is wrapped in a <Profiler>, and every commit is reported here.
 * It does nothing at all unless something has set `__commits` on the
 * global, which only e2e/profile.spec.ts does, so the cost in normal use
 * is one property read per commit.
 *
 * It lives in the demo rather than the library because what it measures is
 * React's work, not the engine's.
 */
export interface Commit {
  phase: "mount" | "update" | "nested-update";
  /** Milliseconds React spent rendering this commit. */
  duration: number;
}

export const onRenderCommit: ProfilerOnRenderCallback = (_id, phase, actualDuration) => {
  const sink = (globalThis as { __commits?: Commit[] }).__commits;
  if (sink) sink.push({ phase, duration: actualDuration });
};
