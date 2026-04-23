import { describe, it, expect } from "vitest";
import { rsiReversionStrategy, rsiReversionDefaults } from "../index.js";
import type { DailyBar } from "../../../types/bar.js";

function mkBar(dayIndex: number, close: number, high?: number, low?: number): DailyBar {
  const d = new Date(Date.UTC(2024, 0, 1));
  d.setUTCDate(d.getUTCDate() + dayIndex);
  return {
    date: d,
    open: close,
    high: high ?? close + 0.1,
    low: low ?? close - 0.1,
    close,
    volume: null,
  };
}

describe("rsiReversionStrategy", () => {
  it("emits long signal when RSI drops into oversold region", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 30; i++) bars.push(mkBar(i, 100 + i));
    for (let i = 0; i < 15; i++) bars.push(mkBar(30 + i, 130 - i * 3));
    const signals = rsiReversionStrategy.generateSignals(bars, "BTC-USD", {
      ...rsiReversionDefaults,
      rsiPeriod: 5,
      atrPeriod: 5,
      buyThreshold: 30,
      sellThreshold: 70,
    });
    const longSignals = signals.filter((s) => s.side === "long");
    expect(longSignals.length).toBeGreaterThan(0);
  });

  it("emits short signal when RSI rises into overbought region", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 30; i++) bars.push(mkBar(i, 130 - i));
    for (let i = 0; i < 15; i++) bars.push(mkBar(30 + i, 100 + i * 3));
    const signals = rsiReversionStrategy.generateSignals(bars, "BTC-USD", {
      ...rsiReversionDefaults,
      rsiPeriod: 5,
      atrPeriod: 5,
      buyThreshold: 30,
      sellThreshold: 70,
    });
    const shortSignals = signals.filter((s) => s.side === "short");
    expect(shortSignals.length).toBeGreaterThan(0);
  });

  it("returns empty array for flat prices", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 100; i++) bars.push(mkBar(i, 100, 100.1, 99.9));
    const signals = rsiReversionStrategy.generateSignals(bars, "BTC-USD", rsiReversionDefaults);
    expect(signals).toEqual([]);
  });

  it("exitConfig has useTrailing: false (reversion doesn't trail)", () => {
    expect(rsiReversionStrategy.exitConfig.useTrailing).toBe(false);
    expect(rsiReversionStrategy.exitConfig.timeStopDays).toBeGreaterThan(0);
  });
});
