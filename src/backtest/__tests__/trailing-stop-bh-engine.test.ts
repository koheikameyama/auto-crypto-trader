import { describe, it, expect } from "vitest";
import {
  runTrailingStopBh,
  trailingStopBhDefaults,
} from "../trailing-stop-bh-engine.js";
import type { DailyBar } from "../../types/bar.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function mkBar(idx: number, close: number): DailyBar {
  return {
    date: new Date(Date.UTC(2024, 0, 1) + idx * DAY_MS),
    open: close,
    high: close,
    low: close,
    close,
    volume: null,
  };
}

describe("runTrailingStopBh", () => {
  it("returns empty for empty bars", () => {
    const r = runTrailingStopBh({
      btcBars: [],
      params: trailingStopBhDefaults,
      initialCapital: 10_000,
    });
    expect(r.trades).toHaveLength(0);
    expect(r.equityCurve).toHaveLength(0);
  });

  it("enters long on first bar and force-closes at end (pure BH when no drawdown)", () => {
    // Monotonic up: never triggers trail stop
    const bars: DailyBar[] = [];
    for (let i = 0; i < 30; i++) bars.push(mkBar(i, 50_000 + i * 1_000));
    const r = runTrailingStopBh({
      btcBars: bars,
      params: { trailDrawdown: 30, reentryGain: 20 },
      initialCapital: 10_000,
    });
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].exitReason).toBe("end_of_data");
    expect(r.trades[0].pnlUsd).toBeGreaterThan(0);
  });

  it("trail stop triggers when close drops below ATH * (1 - dd)", () => {
    // Up to 60k, then drop to 40k (-33% from ATH)
    const bars: DailyBar[] = [];
    for (let i = 0; i < 10; i++) bars.push(mkBar(i, 50_000 + i * 1_000)); // 50k→59k
    bars.push(mkBar(10, 60_000)); // ATH
    bars.push(mkBar(11, 40_000)); // -33% drop → triggers 30% trail stop
    for (let i = 12; i < 20; i++) bars.push(mkBar(i, 40_000)); // flat

    const r = runTrailingStopBh({
      btcBars: bars,
      params: { trailDrawdown: 30, reentryGain: 20 },
      initialCapital: 10_000,
    });
    expect(r.trades.length).toBeGreaterThanOrEqual(1);
    const first = r.trades[0];
    expect(first.exitReason).toBe("trail_stop");
    expect(first.exitDate.getTime()).toBe(bars[11].date.getTime());
  });

  it("re-enters when price recovers by reentryGain% from trough", () => {
    const bars: DailyBar[] = [];
    // Up to 60k then drop to 40k (triggers trail stop at i=11)
    for (let i = 0; i < 11; i++) bars.push(mkBar(i, 50_000 + i * 1_000));
    bars.push(mkBar(11, 40_000));
    bars.push(mkBar(12, 35_000)); // trough
    bars.push(mkBar(13, 38_000)); // +8.6% from trough (below 20%)
    bars.push(mkBar(14, 42_000)); // +20% from trough → re-entry
    bars.push(mkBar(15, 50_000));
    bars.push(mkBar(16, 55_000));

    const r = runTrailingStopBh({
      btcBars: bars,
      params: { trailDrawdown: 30, reentryGain: 20 },
      initialCapital: 10_000,
    });
    // Expect: 1st trade = trail stop exit, 2nd trade = re-entry, end_of_data
    expect(r.trades.length).toBeGreaterThanOrEqual(2);
    const second = r.trades[1];
    expect(second.exitReason).toBe("end_of_data");
    // 2nd trade entered at bar 14 (42_000)
    expect(second.entryDate.getTime()).toBe(bars[14].date.getTime());
  });

  it("equity curve is non-empty and starts near initialCapital", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 10; i++) bars.push(mkBar(i, 50_000));
    const r = runTrailingStopBh({
      btcBars: bars,
      params: { trailDrawdown: 30, reentryGain: 20 },
      initialCapital: 10_000,
    });
    expect(r.equityCurve).toHaveLength(10);
    // First equity point = 10_000 (initial)
    expect(r.equityCurve[0].equity).toBe(10_000);
    // Last equity point: should reflect post-fee round-trip loss (long at 50k, exit at 50k with fee)
    // After fee round trip: ~10_000 - 0.2% = 9980
    expect(r.equityCurve[r.equityCurve.length - 1].equity).toBeLessThan(10_000);
    expect(r.equityCurve[r.equityCurve.length - 1].equity).toBeGreaterThan(
      9_900,
    );
  });

  it("large trail stop value effectively disables protection → matches BH", () => {
    // 99% trail stop → never triggers
    const bars: DailyBar[] = [];
    for (let i = 0; i < 10; i++) bars.push(mkBar(i, 50_000 + i * 100));
    bars.push(mkBar(10, 40_000)); // -20% from ATH, but trail = 99%
    const r = runTrailingStopBh({
      btcBars: bars,
      params: { trailDrawdown: 99, reentryGain: 20 },
      initialCapital: 10_000,
    });
    expect(r.trades).toHaveLength(1);
    expect(r.trades[0].exitReason).toBe("end_of_data");
  });
});
