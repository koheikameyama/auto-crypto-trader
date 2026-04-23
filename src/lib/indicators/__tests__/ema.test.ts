import { describe, it, expect } from "vitest";
import { computeEMA } from "../ema.js";

describe("computeEMA", () => {
  it("returns array aligned with values input, leading nulls during warm-up", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const result = computeEMA(values, 3);
    expect(result.length).toBe(10);
    expect(result[0]).toBeNull();
    expect(typeof result[result.length - 1]).toBe("number");
  });

  it("EMA approaches constant input value", () => {
    const values = new Array(20).fill(5);
    const result = computeEMA(values, 5);
    expect(result[result.length - 1]).toBeCloseTo(5, 5);
  });
});
