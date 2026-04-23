import { describe, it, expect } from "vitest";
import {
  simpleMovingAverage,
  filterEntrySignalsByTrend,
} from "../trend-filter.js";
import type { DailyBar } from "../../types/bar.js";
import type { EntrySignal } from "../../types/signal.js";

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

describe("simpleMovingAverage", () => {
  it("returns all nulls when bars shorter than period", () => {
    const bars = [mkBar(0, 100), mkBar(1, 110)];
    const sma = simpleMovingAverage(bars, 5);
    expect(sma.every((v) => v === null)).toBe(true);
  });

  it("fills initial period-1 positions with null, then SMA values", () => {
    const bars = [1, 2, 3, 4, 5].map((c, i) => mkBar(i, c));
    const sma = simpleMovingAverage(bars, 3);
    expect(sma[0]).toBeNull();
    expect(sma[1]).toBeNull();
    expect(sma[2]).toBeCloseTo(2, 10); // (1+2+3)/3
    expect(sma[3]).toBeCloseTo(3, 10); // (2+3+4)/3
    expect(sma[4]).toBeCloseTo(4, 10); // (3+4+5)/3
  });

  it("handles period=1 (every bar = its own close)", () => {
    const bars = [10, 20, 30].map((c, i) => mkBar(i, c));
    const sma = simpleMovingAverage(bars, 1);
    expect(sma).toEqual([10, 20, 30]);
  });

  it("returns all nulls when period <= 0 (defensive)", () => {
    const bars = [mkBar(0, 100), mkBar(1, 110)];
    expect(simpleMovingAverage(bars, 0).every((v) => v === null)).toBe(true);
    expect(simpleMovingAverage(bars, -3).every((v) => v === null)).toBe(true);
  });
});

describe("filterEntrySignalsByTrend", () => {
  function mkSignal(bar: DailyBar, side: "long" | "short"): EntrySignal {
    return {
      date: bar.date,
      asset: "BTC-USD",
      side,
      entryPrice: bar.close,
      atr: 1,
    };
  }

  it("keeps long signals where close > SMA, drops ones where close <= SMA", () => {
    // 10 bars: 100 → 110 → ... → 190. SMA(3) rises accordingly.
    const bars: DailyBar[] = [];
    for (let i = 0; i < 10; i++) bars.push(mkBar(i, 100 + i * 10));
    // pick bar at index 5 (close=150). SMA(3) at i=5 = (130+140+150)/3 = 140 → 150>140 → keep long
    const keep = mkSignal(bars[5], "long");
    // pick bar at index 2 (close=120). SMA(3) at i=2 = (100+110+120)/3 = 110 → 120>110 → keep long (also passes)
    const alsoKeep = mkSignal(bars[2], "long");
    const result = filterEntrySignalsByTrend(bars, [keep, alsoKeep], 3);
    expect(result).toHaveLength(2);
  });

  it("drops long signals during downtrend (close < SMA)", () => {
    // Falling series: 200 → 100
    const bars: DailyBar[] = [];
    for (let i = 0; i < 10; i++) bars.push(mkBar(i, 200 - i * 10));
    // bar 5: close=150. SMA(3) at i=5 = (170+160+150)/3=160 → 150<160 → drop long
    const sig = mkSignal(bars[5], "long");
    const result = filterEntrySignalsByTrend(bars, [sig], 3);
    expect(result).toHaveLength(0);
  });

  it("keeps short signals only when close < SMA (downtrend-aligned)", () => {
    // Falling series
    const bars: DailyBar[] = [];
    for (let i = 0; i < 10; i++) bars.push(mkBar(i, 200 - i * 10));
    // bar 5 close=150 < SMA(3)=160 → short aligned
    const shortSig = mkSignal(bars[5], "short");
    const longSig = mkSignal(bars[5], "long");
    const result = filterEntrySignalsByTrend(bars, [shortSig, longSig], 3);
    expect(result).toHaveLength(1);
    expect(result[0].side).toBe("short");
  });

  it("drops signals during SMA warm-up (null SMA)", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 10; i++) bars.push(mkBar(i, 100 + i));
    // bar at index 1: SMA(5) is null → drop even if long
    const sig = mkSignal(bars[1], "long");
    const result = filterEntrySignalsByTrend(bars, [sig], 5);
    expect(result).toHaveLength(0);
  });

  it("drops signals whose date is not in bars (defensive)", () => {
    const bars = [mkBar(0, 100), mkBar(1, 110), mkBar(2, 120)];
    const orphan: EntrySignal = {
      date: new Date("2030-01-01"),
      asset: "BTC-USD",
      side: "long",
      entryPrice: 100,
      atr: 1,
    };
    const result = filterEntrySignalsByTrend(bars, [orphan], 2);
    expect(result).toHaveLength(0);
  });

  it("handles empty signal list", () => {
    const bars = [mkBar(0, 100), mkBar(1, 110)];
    expect(filterEntrySignalsByTrend(bars, [], 2)).toEqual([]);
  });
});
