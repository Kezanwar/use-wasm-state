import { describe, expect, it } from "vitest";
import { winners } from "../examples/react-demo/src/bench/winners.mjs";

describe("benchmark winners", () => {
  it("is the lowest value", () => {
    expect(winners([30, 10, 20])).toEqual([false, true, false]);
  });

  it("marks every tie", () => {
    expect(winners([10, 10, 20])).toEqual([true, true, false]);
    expect(winners([0, 0, 3])).toEqual([true, true, false]);
  });

  it("counts anything within 5% of the best as a win, and nothing past it", () => {
    expect(winners([100, 105, 105.1])).toEqual([true, true, false]);
  });

  it("skips missing values, and needs two to compare", () => {
    expect(winners([null, 20, 10])).toEqual([false, false, true]);
    expect(winners([null, null, 10])).toEqual([false, false, false]);
  });
});
