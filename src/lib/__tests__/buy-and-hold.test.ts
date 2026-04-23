import { describe, it, expect } from "vitest";
import { buyAndHold } from "../buy-and-hold.js";
import type { DailyBar } from "../../types/bar.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function mkBars(startDate: string, prices: number[]): DailyBar[] {
  const base = new Date(`${startDate}T00:00:00Z`).getTime();
  return prices.map((p, i) => ({
    date: new Date(base + i * DAY_MS),
    open: p,
    high: p,
    low: p,
    close: p,
    volume: null,
  }));
}

describe("buyAndHold", () => {
  it("returns null for empty or single-bar input", () => {
    expect(buyAndHold([])).toBeNull();
    expect(buyAndHold(mkBars("2024-01-01", [100]))).toBeNull();
  });

  it("computes totalReturn correctly for doubling price", () => {
    const bars = mkBars("2024-01-01", [100, 150, 200]);
    const r = buyAndHold(bars)!;
    expect(r.totalReturn).toBeCloseTo(1.0, 5);
    expect(r.startPrice).toBe(100);
    expect(r.endPrice).toBe(200);
  });

  it("computes 0 return when start == end price", () => {
    const bars = mkBars("2024-01-01", [100, 110, 90, 100]);
    const r = buyAndHold(bars)!;
    expect(r.totalReturn).toBe(0);
  });

  it("computes maxDrawdown correctly", () => {
    // 100 → 150 → 90: peak 150, trough 90, DD = (150-90)/150 = 0.4
    const bars = mkBars("2024-01-01", [100, 150, 90]);
    const r = buyAndHold(bars)!;
    expect(r.maxDrawdown).toBeCloseTo(0.4, 5);
  });

  it("produces daily returns of length = bars - 1", () => {
    const bars = mkBars("2024-01-01", [100, 110, 121, 130]);
    const r = buyAndHold(bars)!;
    expect(r.returns).toHaveLength(3);
    expect(r.returns[0]).toBeCloseTo(0.1, 5);
    expect(r.returns[1]).toBeCloseTo(0.1, 5);
  });

  it("Sharpe is 0 when returns are constant (no variance)", () => {
    // Every 100% daily return → std=0 exactly (no FP rounding)
    const bars = mkBars("2024-01-01", [100, 200, 400, 800]);
    const r = buyAndHold(bars)!;
    expect(r.sharpe).toBe(0);
  });

  it("Sharpe is positive for rising-with-variance series", () => {
    const bars = mkBars("2024-01-01", [100, 105, 103, 108, 106, 112, 115]);
    const r = buyAndHold(bars)!;
    expect(r.sharpe).toBeGreaterThan(0);
  });
});
