import { describe, it, expect } from "vitest";
import { runCombinedBacktest } from "../crypto-combined-run.js";
import type { DailyBar } from "../../types/bar.js";
import type { EntrySignal } from "../../types/signal.js";
import type { Strategy } from "../../types/strategy.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function mkDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

function makeRisingBars(
  startDate: string,
  startPrice: number,
  endPrice: number,
  days: number,
): DailyBar[] {
  const bars: DailyBar[] = [];
  const step = (endPrice - startPrice) / (days - 1);
  const base = mkDate(startDate).getTime();
  for (let i = 0; i < days; i++) {
    const d = new Date(base + i * DAY_MS);
    const p = startPrice + step * i;
    bars.push({ date: d, open: p, high: p + 5, low: p - 5, close: p, volume: null });
  }
  return bars;
}

function mkStrategyEmittingFirstLong(): Strategy<Record<string, unknown>> {
  return {
    name: "mock-long",
    defaultParams: {},
    exitConfig: {
      useTrailing: false,
      timeStopDays: 15,
      timeStopMaxDays: 15,
      slAtrMultiplier: 2.0,
      beAtrMultiplier: 10,
      trailAtrMultiplier: 10,
    },
    generateSignals(bars, asset): EntrySignal[] {
      if (bars.length === 0) return [];
      return [
        {
          date: bars[0].date,
          asset,
          side: "long",
          entryPrice: bars[0].close,
          atr: 500,
        },
      ];
    },
  };
}

describe("runCombinedBacktest", () => {
  it("returns zeros for empty assets array", () => {
    const r = runCombinedBacktest({
      assets: [],
      initialCapital: 10_000,
      riskRatio: 0.01,
    });
    expect(r.trades).toHaveLength(0);
    expect(r.equityCurve).toHaveLength(0);
    expect(r.tradeCount).toBe(0);
    expect(r.totalReturn).toBe(0);
    expect(r.perAsset).toHaveLength(0);
  });

  it("equal-weights capital across assets by default", () => {
    const strat = mkStrategyEmittingFirstLong();
    const btcBars = makeRisingBars("2024-01-01", 50_000, 55_000, 30);
    const ethBars = makeRisingBars("2024-01-01", 3_000, 3_300, 30);

    const r = runCombinedBacktest({
      assets: [
        { asset: "BTC-USD", bars: btcBars, strategy: strat, params: {} },
        { asset: "ETH-USD", bars: ethBars, strategy: strat, params: {} },
      ],
      initialCapital: 10_000,
      riskRatio: 0.01,
    });
    expect(r.perAsset).toHaveLength(2);
    expect(r.perAsset[0].weight).toBeCloseTo(0.5, 10);
    expect(r.perAsset[1].weight).toBeCloseTo(0.5, 10);
  });

  it("merges equity curves by date and sums equities", () => {
    const strat = mkStrategyEmittingFirstLong();
    const btcBars = makeRisingBars("2024-01-01", 50_000, 55_000, 20);
    const ethBars = makeRisingBars("2024-01-01", 3_000, 3_300, 20);

    const r = runCombinedBacktest({
      assets: [
        { asset: "BTC-USD", bars: btcBars, strategy: strat, params: {} },
        { asset: "ETH-USD", bars: ethBars, strategy: strat, params: {} },
      ],
      initialCapital: 10_000,
      riskRatio: 0.01,
    });
    // Equity curves should share dates and start close to 10000 (ignoring fee on entry)
    expect(r.equityCurve.length).toBe(20);
    // First equity point should be ~10000 (initial capital, minor fee impact from open position)
    expect(r.equityCurve[0].equity).toBeGreaterThan(9_000);
    expect(r.equityCurve[0].equity).toBeLessThan(10_100);
  });

  it("combines trade lists from all assets", () => {
    const strat = mkStrategyEmittingFirstLong();
    const btcBars = makeRisingBars("2024-01-01", 50_000, 55_000, 20);
    const ethBars = makeRisingBars("2024-01-01", 3_000, 3_300, 20);

    const r = runCombinedBacktest({
      assets: [
        { asset: "BTC-USD", bars: btcBars, strategy: strat, params: {} },
        { asset: "ETH-USD", bars: ethBars, strategy: strat, params: {} },
      ],
      initialCapital: 10_000,
      riskRatio: 0.01,
    });
    // Each asset emits 1 signal → 2 trades total
    expect(r.tradeCount).toBe(2);
    const assets = r.trades.map((t) => t.asset).sort();
    expect(assets).toEqual(["BTC-USD", "ETH-USD"]);
  });

  it("respects custom weights", () => {
    const strat = mkStrategyEmittingFirstLong();
    const btcBars = makeRisingBars("2024-01-01", 50_000, 55_000, 20);
    const ethBars = makeRisingBars("2024-01-01", 3_000, 3_300, 20);

    const r = runCombinedBacktest({
      assets: [
        { asset: "BTC-USD", bars: btcBars, strategy: strat, params: {} },
        { asset: "ETH-USD", bars: ethBars, strategy: strat, params: {} },
      ],
      initialCapital: 10_000,
      riskRatio: 0.01,
      weights: [0.7, 0.3],
    });
    expect(r.perAsset[0].weight).toBe(0.7);
    expect(r.perAsset[1].weight).toBe(0.3);
  });

  it("throws if weights length does not match assets length", () => {
    const strat = mkStrategyEmittingFirstLong();
    const btcBars = makeRisingBars("2024-01-01", 50_000, 55_000, 20);
    expect(() =>
      runCombinedBacktest({
        assets: [{ asset: "BTC-USD", bars: btcBars, strategy: strat, params: {} }],
        initialCapital: 10_000,
        riskRatio: 0.01,
        weights: [0.5, 0.5],
      }),
    ).toThrow(/weights length/);
  });
});
