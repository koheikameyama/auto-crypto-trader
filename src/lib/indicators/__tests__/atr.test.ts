import { describe, it, expect } from "vitest";
import { computeATR } from "../atr.js";
import type { DailyBar } from "../../../types/bar.js";

function bar(high: number, low: number, close: number): DailyBar {
  return { date: new Date(), high, low, close, open: close, volume: null };
}

describe("computeATR", () => {
  it("returns array aligned with bars, with leading nulls during warm-up", () => {
    const bars = [
      bar(10, 9, 9.5),
      bar(11, 10, 10.5),
      bar(12, 11, 11.5),
      bar(13, 11, 12),
      bar(14, 12, 13),
    ];
    const result = computeATR(bars, 3);
    expect(result.length).toBe(5);
    // first (period - 1) or (period) values are null depending on implementation
    expect(result[0]).toBeNull();
    // later values should be numbers
    expect(typeof result[result.length - 1]).toBe("number");
  });

  it("returns all nulls when bars shorter than period", () => {
    const bars = [bar(10, 9, 9.5), bar(11, 10, 10.5)];
    const result = computeATR(bars, 14);
    expect(result.every((v) => v === null)).toBe(true);
  });
});
