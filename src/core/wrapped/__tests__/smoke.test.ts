import { describe, it, expect } from "vitest";
import { donchianTrendFilteredStrategy } from "../donchian-tf.js";
import { maCrossoverTrendFilteredStrategy } from "../ma-crossover-tf.js";
import { rsiReversionTrendFilteredStrategy } from "../rsi-reversion-tf.js";
import { nr7BreakoutTrendFilteredStrategy } from "../nr7-breakout-tf.js";
import { donchianStrategy } from "../../donchian/index.js";
import { maCrossoverStrategy } from "../../ma-crossover/index.js";
import { rsiReversionStrategy } from "../../rsi-reversion/index.js";
import { nr7BreakoutStrategy } from "../../nr7-breakout/index.js";
import type { DailyBar } from "../../../types/bar.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function mkBar(idx: number, close: number, high?: number, low?: number): DailyBar {
  return {
    date: new Date(Date.UTC(2024, 0, 1) + idx * DAY_MS),
    open: close,
    high: high ?? close + 1,
    low: low ?? close - 1,
    close,
    volume: null,
  };
}

describe("wrapped strategies — smoke tests", () => {
  it("donchian-tf: filtered <= raw signal count", () => {
    // Uptrending then sharp reversal creates both long/short signals
    const bars: DailyBar[] = [];
    for (let i = 0; i < 250; i++) {
      const c = 100 + Math.sin(i * 0.2) * 10 + i * 0.1;
      bars.push(mkBar(i, c));
    }
    const raw = donchianStrategy.generateSignals(
      bars,
      "BTC-USD",
      donchianStrategy.defaultParams,
    );
    const filtered = donchianTrendFilteredStrategy.generateSignals(
      bars,
      "BTC-USD",
      donchianStrategy.defaultParams,
    );
    expect(filtered.length).toBeLessThanOrEqual(raw.length);
  });

  it("ma-crossover-tf, rsi-reversion-tf, nr7-tf: filtered <= raw", () => {
    const bars: DailyBar[] = [];
    for (let i = 0; i < 300; i++) {
      const c = 100 + Math.sin(i * 0.1) * 15 + i * 0.05;
      bars.push(mkBar(i, c));
    }
    const raws = [
      maCrossoverStrategy.generateSignals(
        bars,
        "BTC-USD",
        maCrossoverStrategy.defaultParams,
      ),
      rsiReversionStrategy.generateSignals(
        bars,
        "BTC-USD",
        rsiReversionStrategy.defaultParams,
      ),
      nr7BreakoutStrategy.generateSignals(
        bars,
        "BTC-USD",
        nr7BreakoutStrategy.defaultParams,
      ),
    ];
    const filteredCounts = [
      maCrossoverTrendFilteredStrategy.generateSignals(
        bars,
        "BTC-USD",
        maCrossoverStrategy.defaultParams,
      ).length,
      rsiReversionTrendFilteredStrategy.generateSignals(
        bars,
        "BTC-USD",
        rsiReversionStrategy.defaultParams,
      ).length,
      nr7BreakoutTrendFilteredStrategy.generateSignals(
        bars,
        "BTC-USD",
        nr7BreakoutStrategy.defaultParams,
      ).length,
    ];
    for (let i = 0; i < raws.length; i++) {
      expect(filteredCounts[i]).toBeLessThanOrEqual(raws[i].length);
    }
  });

  it("wrapped strategies expose same name/exitConfig structure", () => {
    expect(donchianTrendFilteredStrategy.name).toBe("donchian-tf");
    expect(donchianTrendFilteredStrategy.exitConfig).toEqual(
      donchianStrategy.exitConfig,
    );
    expect(donchianTrendFilteredStrategy.defaultParams).toEqual(
      donchianStrategy.defaultParams,
    );
  });

  it("in a pure uptrend (close always > SMA200), ALL long signals survive filter", () => {
    // Strictly monotonic rising: every close > SMA (after warm-up)
    const bars: DailyBar[] = [];
    for (let i = 0; i < 400; i++) bars.push(mkBar(i, 100 + i));
    const raw = donchianStrategy.generateSignals(
      bars,
      "BTC-USD",
      donchianStrategy.defaultParams,
    );
    const filtered = donchianTrendFilteredStrategy.generateSignals(
      bars,
      "BTC-USD",
      donchianStrategy.defaultParams,
    );
    // Shorts in monotonic uptrend = 0, filter shouldn't drop any longs after warm-up
    const rawLongsAfterWarmup = raw.filter(
      (s) => s.side === "long" && bars.findIndex((b) => b.date.getTime() === s.date.getTime()) >= 199,
    );
    const filteredLongs = filtered.filter((s) => s.side === "long");
    expect(filteredLongs.length).toBe(rawLongsAfterWarmup.length);
  });
});
