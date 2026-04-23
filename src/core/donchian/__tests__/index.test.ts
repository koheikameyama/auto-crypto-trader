import { describe, it, expect } from "vitest";
import { donchianStrategy, donchianDefaults } from "../index.js";
import type { DailyBar } from "../../../types/bar.js";

function mkBar(dateStr: string, close: number, high?: number, low?: number): DailyBar {
  return {
    date: new Date(`${dateStr}T00:00:00Z`),
    open: close,
    high: high ?? close,
    low: low ?? close,
    close,
    volume: null,
  };
}

describe("donchianStrategy", () => {
  it("emits long signal when close breaks above prior upper", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 20; i++)
      bars.push(mkBar(`2024-01-${String(i + 1).padStart(2, "0")}`, 100 + i, 100 + i + 1, 100 + i - 1));
    bars.push(mkBar("2024-02-01", 130, 130, 129));
    const signals = donchianStrategy.generateSignals(bars, "BTC-USD", {
      ...donchianDefaults,
      entryPeriod: 10,
      atrPeriod: 5,
    });
    const longSignals = signals.filter((s) => s.side === "long");
    expect(longSignals.length).toBeGreaterThan(0);
    const last = signals[signals.length - 1];
    expect(last.side).toBe("long");
    expect(last.entryPrice).toBe(130);
  });

  it("emits short signal when close breaks below prior lower", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 20; i++)
      bars.push(mkBar(`2024-01-${String(i + 1).padStart(2, "0")}`, 100 - i, 100 - i + 1, 100 - i - 1));
    bars.push(mkBar("2024-02-01", 70, 71, 70));
    const signals = donchianStrategy.generateSignals(bars, "BTC-USD", {
      ...donchianDefaults,
      entryPeriod: 10,
      atrPeriod: 5,
    });
    const shortSignals = signals.filter((s) => s.side === "short");
    expect(shortSignals.length).toBeGreaterThan(0);
  });

  it("returns empty array for flat prices (no breakout)", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 30; i++)
      bars.push(mkBar(`2024-01-${String(i + 1).padStart(2, "0")}`, 100, 100.1, 99.9));
    const signals = donchianStrategy.generateSignals(bars, "BTC-USD", donchianDefaults);
    expect(signals).toEqual([]);
  });

  it("exitConfig has trailing enabled and reasonable defaults", () => {
    expect(donchianStrategy.exitConfig.useTrailing).toBe(true);
    expect(donchianStrategy.exitConfig.timeStopDays).toBeGreaterThan(0);
  });
});
