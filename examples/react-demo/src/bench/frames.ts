/**
 * What an operation costs the page rather than the clock: the longest frame
 * while it runs, and how many frames it cost. Browser only.
 *
 * A frame is measured from one requestAnimationFrame to the next. The
 * budget is the display's own frame, taken from idle frames first, so a
 * 120 Hz screen is not graded against 60.
 */

export interface FrameCost {
  /** Longest frame, in milliseconds. */
  worst: number;
  /** Frames that should have been painted and were not. */
  dropped: number;
}

const nextFrame = () => new Promise<number>((resolve) => requestAnimationFrame(resolve));

/** The display's frame interval, from a run of idle frames. */
export async function frameBudget(samples = 20): Promise<number> {
  let previous = await nextFrame();
  const intervals: number[] = [];
  for (let i = 0; i < samples; i++) {
    const now = await nextFrame();
    intervals.push(now - previous);
    previous = now;
  }
  intervals.sort((a, b) => a - b);
  return intervals[Math.floor(intervals.length / 2)]!;
}

/**
 * Run something and record every frame from just before it starts until
 * its result has painted.
 */
export async function measureFrames(run: () => unknown, budget: number): Promise<FrameCost> {
  const intervals: number[] = [];
  let recording = true;
  let previous = await nextFrame();

  const loop = (now: number) => {
    intervals.push(now - previous);
    previous = now;
    if (recording) requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);

  await run();
  // Two more frames: one to commit what came back, one to paint it.
  await nextFrame();
  await nextFrame();
  recording = false;
  await nextFrame();

  const worst = Math.max(budget, ...intervals);
  const dropped = intervals.reduce(
    (sum, interval) => sum + Math.max(0, Math.round(interval / budget) - 1),
    0
  );
  return { worst, dropped };
}
