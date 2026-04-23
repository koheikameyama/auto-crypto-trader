import { describe, it, expect } from "vitest";
import { computeRSI } from "../rsi.js";

describe("computeRSI", () => {
  it("returns array aligned with values input", () => {
    // 20 values alternating to create varied gains/losses
    const values = [
      10, 11, 10.5, 12, 11.8, 13, 12.5, 14, 13.5, 15,
      14.5, 16, 15.5, 17, 16.5, 18, 17.5, 19, 18.5, 20,
    ];
    const result = computeRSI(values, 14);
    expect(result.length).toBe(20);
    expect(result[0]).toBeNull();
    const last = result[result.length - 1];
    expect(typeof last).toBe("number");
    expect(last!).toBeGreaterThanOrEqual(0);
    expect(last!).toBeLessThanOrEqual(100);
  });

  it("returns ~100 for purely rising sequence", () => {
    const values = Array.from({ length: 30 }, (_, i) => 100 + i);
    const result = computeRSI(values, 14);
    const last = result[result.length - 1];
    expect(last!).toBeGreaterThan(90);
  });

  it("returns ~0 for purely falling sequence", () => {
    const values = Array.from({ length: 30 }, (_, i) => 100 - i);
    const result = computeRSI(values, 14);
    const last = result[result.length - 1];
    expect(last!).toBeLessThan(10);
  });
});
