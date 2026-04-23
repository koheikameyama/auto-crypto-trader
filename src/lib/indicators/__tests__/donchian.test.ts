import { describe, it, expect } from "vitest";
import { donchianChannel } from "../donchian.js";
import type { DailyBar } from "../../../types/bar.js";

function bar(high: number, low: number): DailyBar {
  return { date: new Date(), high, low, close: (high + low) / 2, open: (high + low) / 2, volume: null };
}

describe("donchianChannel", () => {
  it("returns upper/lower arrays aligned with bars", () => {
    const bars = [bar(10, 8), bar(12, 9), bar(11, 7), bar(13, 10)];
    const { upper, lower } = donchianChannel(bars, 3);
    expect(upper.length).toBe(4);
    expect(lower.length).toBe(4);
    // period=3, so indices 0 and 1 are null
    expect(upper[0]).toBeNull();
    expect(upper[1]).toBeNull();
    expect(upper[2]).toBe(12); // max of [10,12,11]
    expect(lower[2]).toBe(7); // min of [8,9,7]
    expect(upper[3]).toBe(13); // max of [12,11,13]
    expect(lower[3]).toBe(7); // min of [9,7,10]
  });

  it("returns all nulls when bars shorter than period", () => {
    const bars = [bar(10, 8)];
    const { upper, lower } = donchianChannel(bars, 5);
    expect(upper.every((v) => v === null)).toBe(true);
    expect(lower.every((v) => v === null)).toBe(true);
  });
});
