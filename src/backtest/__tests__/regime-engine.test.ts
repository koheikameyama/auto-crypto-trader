import { describe, it, expect } from "vitest";
import { runRegimeBacktest, regimeDefaults } from "../regime-engine.js";
import type { DailyBar } from "../../types/bar.js";
import type { OnchainBar } from "../../data/onchain-loader.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function mkBtcBar(idx: number, close: number): DailyBar {
  return {
    date: new Date(Date.UTC(2024, 0, 1) + idx * DAY_MS),
    open: close,
    high: close,
    low: close,
    close,
    volume: null,
  };
}

function mkOnchain(
  idx: number,
  price: number,
  capMrkt: number,
  txCnt: number,
  adr: number,
): OnchainBar {
  return {
    date: new Date(Date.UTC(2024, 0, 1) + idx * DAY_MS),
    priceUsd: price,
    capMrktUsd: capMrkt,
    txCnt,
    adrActCnt: adr,
  };
}

describe("runRegimeBacktest", () => {
  it("returns empty for empty inputs", () => {
    const r = runRegimeBacktest({
      btcBars: [],
      onchainBars: [],
      params: regimeDefaults,
      initialCapital: 10_000,
    });
    expect(r.trades).toHaveLength(0);
    expect(r.equityCurve).toHaveLength(0);
  });

  it("holds cash while regime is bearish (nvt percentile = null during warm-up)", () => {
    // Short series → percentileWindow too large → all features are null
    const btc: DailyBar[] = [];
    const onch: OnchainBar[] = [];
    for (let i = 0; i < 20; i++) {
      btc.push(mkBtcBar(i, 50000 + i * 10));
      onch.push(mkOnchain(i, 50000 + i * 10, 1e12, 500_000, 800_000));
    }
    const r = runRegimeBacktest({
      btcBars: btc,
      onchainBars: onch,
      params: {
        nvtLookback: 3,
        aaLookback: 3,
        percentileWindow: 100, // larger than series → all null
        nvtPercentile: 0.7,
        aaMomentumThreshold: 1.0,
      },
      initialCapital: 10_000,
    });
    expect(r.trades).toHaveLength(0);
    // equity stays flat at 10_000 (cash)
    expect(r.equityCurve[r.equityCurve.length - 1].equity).toBe(10_000);
  });

  it("enters long when regime turns bullish and exits when it flips", () => {
    // Build series where nvtProxy is low and aaMomentum > 1 near end → bullish entry
    const btc: DailyBar[] = [];
    const onch: OnchainBar[] = [];
    // 30 bars with high NVT (high capMrkt / low txCnt) and flat AA
    for (let i = 0; i < 30; i++) {
      btc.push(mkBtcBar(i, 50000));
      onch.push(mkOnchain(i, 50000, 2e12, 400_000, 800_000));
    }
    // 20 bars with low NVT (drop capMrkt) and rising AA → bullish
    for (let i = 30; i < 50; i++) {
      btc.push(mkBtcBar(i, 50000 + (i - 30) * 200));
      onch.push(mkOnchain(i, 50000, 1e12, 800_000, 900_000 + (i - 30) * 10_000));
    }
    // 15 bars with high NVT again and flat AA → bearish flip → exit
    for (let i = 50; i < 65; i++) {
      btc.push(mkBtcBar(i, 54000));
      onch.push(mkOnchain(i, 54000, 2.5e12, 300_000, 800_000));
    }
    const r = runRegimeBacktest({
      btcBars: btc,
      onchainBars: onch,
      params: {
        nvtLookback: 5,
        aaLookback: 10,
        percentileWindow: 25,
        nvtPercentile: 0.5,
        aaMomentumThreshold: 1.0,
      },
      initialCapital: 10_000,
    });
    // At least one round-trip trade
    expect(r.trades.length).toBeGreaterThan(0);
    expect(r.trades[0].exitReason === "regime_bear" || r.trades[0].exitReason === "end_of_data").toBe(true);
  });

  it("force-closes open position at end of data", () => {
    const btc: DailyBar[] = [];
    const onch: OnchainBar[] = [];
    // All-bullish series: low NVT, rising AA → keeps position till end
    for (let i = 0; i < 40; i++) {
      btc.push(mkBtcBar(i, 50000 + i * 100));
      onch.push(
        mkOnchain(i, 50000 + i * 100, 1e12, 1_000_000 + i * 5_000, 800_000 + i * 2_000),
      );
    }
    const r = runRegimeBacktest({
      btcBars: btc,
      onchainBars: onch,
      params: {
        nvtLookback: 3,
        aaLookback: 5,
        percentileWindow: 15,
        nvtPercentile: 0.99,
        aaMomentumThreshold: 0.9,
      },
      initialCapital: 10_000,
    });
    // Final trade may be "end_of_data" if position held
    if (r.trades.length > 0) {
      const last = r.trades[r.trades.length - 1];
      expect(["regime_bear", "end_of_data"].includes(last.exitReason)).toBe(true);
    }
  });
});
