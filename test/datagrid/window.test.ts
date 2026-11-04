import { describe, expect, it } from "vitest";
import { windowFor } from "../../src/datagrid/read-hooks";

/** Ten rows visible, the defaults per mode. */
const sync = (top: number, rowCount = 1000) =>
  windowFor({ top, visible: 10, rowCount, overscan: 4, block: 1 });
const worker = (top: number, rowCount = 1000) =>
  windowFor({ top, visible: 10, rowCount, overscan: 16, block: 16 });

describe("the window", () => {
  it("covers the visible rows, the overscan either side and one partly visible row", () => {
    expect(sync(503)).toEqual({ start: 499, count: 4 + 10 + 4 + 1 });
  });

  it("follows the scroll row by row on the main thread", () => {
    expect(sync(504).start).toBe(500);
    expect(sync(505).start).toBe(501);
  });

  it("snaps to blocks in a worker, so nearby rows ask for the same window", () => {
    // 503 less sixteen of overscan is 487, snapped down to 480.
    expect(worker(503)).toEqual({ start: 480, count: 64 });
    expect(worker(496)).toEqual(worker(503));
    expect(worker(497).start).toBe(480);
    expect(worker(512).start).toBe(496);
    // Still reaches past the last visible row with overscan to spare.
    const { start, count } = worker(511);
    expect(start + count).toBeGreaterThanOrEqual(511 + 10 + 16);
  });

  it("takes a larger overscan when given one", () => {
    expect(windowFor({ top: 100, visible: 10, rowCount: 1000, overscan: 8, block: 1 })).toEqual({
      start: 92,
      count: 27,
    });
  });

  it("clamps at the top", () => {
    expect(sync(0)).toEqual({ start: 0, count: 19 });
    expect(sync(2).start).toBe(0);
    expect(worker(10).start).toBe(0);
  });

  it("clamps at the bottom, ending at the last row", () => {
    expect(sync(990)).toEqual({ start: 981, count: 19 });
    const { start, count } = worker(990);
    expect(start + count).toBe(1000);
  });

  it("does not go empty when the grid shrinks below the scroll position", () => {
    // A filter applied while scrolled far down: the last rows, not none.
    expect(sync(5000, 30)).toEqual({ start: 11, count: 19 });
    expect(worker(5000, 30)).toEqual({ start: 0, count: 30 });
    expect(sync(5000, 5)).toEqual({ start: 0, count: 5 });
    expect(sync(5000, 0)).toEqual({ start: 0, count: 0 });
  });
});
