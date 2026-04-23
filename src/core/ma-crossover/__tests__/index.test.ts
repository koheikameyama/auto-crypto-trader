import { describe, it, expect } from "vitest";
import { maCrossoverStrategy, maCrossoverDefaults } from "../index.js";
import type { DailyBar } from "../../../types/bar.js";

function mkBar(dayIndex: number, close: number, high?: number, low?: number): DailyBar {
  const d = new Date(Date.UTC(2024, 0, 1));
  d.setUTCDate(d.getUTCDate() + dayIndex);
  return {
    date: d,
    open: close,
    high: high ?? close + 0.5,
    low: low ?? close - 0.5,
    close,
    volume: null,
  };
}

describe("maCrossoverStrategy", () => {
  it("emits long signal on upward crossover", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 60; i++) bars.push(mkBar(i, 100 - i * 0.5));
    for (let i = 0; i < 40; i++) bars.push(mkBar(60 + i, 70 + i * 1.5));
    const signals = maCrossoverStrategy.generateSignals(bars, "BTC-USD", {
      ...maCrossoverDefaults,
      shortEma: 5,
      longEma: 20,
      atrPeriod: 5,
    });
    const longSignals = signals.filter((s) => s.side === "long");
    expect(longSignals.length).toBeGreaterThan(0);
  });

  it("emits short signal on downward crossover", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 60; i++) bars.push(mkBar(i, 50 + i * 0.5));
    for (let i = 0; i < 40; i++) bars.push(mkBar(60 + i, 80 - i * 1.5));
    const signals = maCrossoverStrategy.generateSignals(bars, "BTC-USD", {
      ...maCrossoverDefaults,
      shortEma: 5,
      longEma: 20,
      atrPeriod: 5,
    });
    const shortSignals = signals.filter((s) => s.side === "short");
    expect(shortSignals.length).toBeGreaterThan(0);
  });

  it("returns empty array for flat prices", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 100; i++) bars.push(mkBar(i, 100, 100.1, 99.9));
    const signals = maCrossoverStrategy.generateSignals(bars, "BTC-USD", maCrossoverDefaults);
    expect(signals).toEqual([]);
  });

  it("exitConfig has trailing enabled and reasonable defaults", () => {
    expect(maCrossoverStrategy.exitConfig.useTrailing).toBe(true);
    expect(maCrossoverStrategy.exitConfig.timeStopDays).toBeGreaterThan(0);
    expect(maCrossoverStrategy.exitConfig.timeStopMaxDays).toBeGreaterThan(
      maCrossoverStrategy.exitConfig.timeStopDays - 1,
    );
  });
});
