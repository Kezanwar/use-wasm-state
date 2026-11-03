/**
 * Which values in a row win: the lowest, and any within 5% of it, so noise
 * between near-equal results is not presented as a win. Every figure in
 * the benchmark is lower-is-better. Plain JavaScript so the README script
 * can import it as well as the Benchmarks tab.
 *
 * A row with fewer than two values has nothing to beat, so nothing wins.
 *
 * @param {readonly (number | null)[]} values
 * @returns {boolean[]}
 */
export function winners(values) {
  const present = values.filter((value) => value !== null);
  if (present.length < 2) return values.map(() => false);
  const best = Math.min(...present);
  return values.map((value) => value !== null && value <= best * 1.05);
}
