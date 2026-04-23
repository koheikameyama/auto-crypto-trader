import { describe, it, expect } from "vitest";
import { nr7BreakoutStrategy, nr7Defaults } from "../index.js";
import type { DailyBar } from "../../../types/bar.js";

function mkBar(dayIndex: number, close: number, high: number, low: number): DailyBar {
  const d = new Date(Date.UTC(2024, 0, 1));
  d.setUTCDate(d.getUTCDate() + dayIndex);
  return {
    date: d,
    open: close,
    high,
    low,
    close,
    volume: null,
  };
}

describe("nr7BreakoutStrategy", () => {
  it("emits long signal after NR7 with upward break", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 20; i++) {
      bars.push(mkBar(i, 100 + i * 0.1, 100 + i * 0.1 + 1, 100 + i * 0.1 - 1));
    }
    bars.push(mkBar(20, 102.0, 102.05, 101.95));
    bars.push(mkBar(21, 103.0, 103.5, 102.5));

    const signals = nr7BreakoutStrategy.generateSignals(bars, "BTC-USD", {
      ...nr7Defaults,
      lookback: 7,
      atrPeriod: 5,
    });
    expect(signals.length).toBe(1);
    expect(signals[0].side).toBe("long");
    expect(signals[0].entryPrice).toBe(103.0);
  });

  it("emits short signal after NR7 with downward break", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 20; i++) {
      bars.push(mkBar(i, 100 - i * 0.1, 100 - i * 0.1 + 1, 100 - i * 0.1 - 1));
    }
    bars.push(mkBar(20, 98.0, 98.05, 97.95));
    bars.push(mkBar(21, 97.0, 97.5, 96.5));

    const signals = nr7BreakoutStrategy.generateSignals(bars, "BTC-USD", {
      ...nr7Defaults,
      lookback: 7,
      atrPeriod: 5,
    });
    expect(signals.length).toBe(1);
    expect(signals[0].side).toBe("short");
    expect(signals[0].entryPrice).toBe(97.0);
  });

  it("returns empty array when no NR7 forms (uniform ranges)", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 30; i++) {
      bars.push(mkBar(i, 100 + (i % 2) * 0.2, 101, 99));
    }
    const signals = nr7BreakoutStrategy.generateSignals(bars, "BTC-USD", nr7Defaults);
    expect(signals).toEqual([]);
  });

  it("exitConfig has trailing enabled and reasonable defaults", () => {
    expect(nr7BreakoutStrategy.exitConfig.useTrailing).toBe(true);
    expect(nr7BreakoutStrategy.exitConfig.timeStopDays).toBeGreaterThan(0);
  });
});
