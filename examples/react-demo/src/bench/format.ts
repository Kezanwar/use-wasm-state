/** Milliseconds, in whichever unit reads best. */
export function formatMs(ms: number): string {
  if (ms >= 100) return `${Math.round(ms)} ms`;
  if (ms >= 10) return `${ms.toFixed(1)} ms`;
  if (ms >= 1) return `${ms.toFixed(2)} ms`;
  const us = ms * 1000;
  if (us >= 100) return `${Math.round(us)} µs`;
  if (us >= 10) return `${us.toFixed(1)} µs`;
  if (us >= 1) return `${us.toFixed(2)} µs`;
  return `${Math.round(us * 1000)} ns`;
}

export const formatMB = (bytes: number) => `${(bytes / 1e6).toFixed(1)} MB`;

export const formatKB = (bytes: number) => `${(bytes / 1000).toFixed(1)} kB`;

/** A speed ratio, for a tooltip. */
export function formatFactor(factor: number): string {
  if (factor >= 1.05) return `${factor >= 10 ? Math.round(factor) : factor.toFixed(1)}× faster`;
  if (factor <= 0.95) {
    const slower = 1 / factor;
    return `${slower >= 10 ? Math.round(slower) : slower.toFixed(1)}× slower`;
  }
  return "the same";
}
