import { describe, it, expect } from "vitest";
import {
  alignAndComputeSpread,
  computeRollingZScore,
  type SpreadBar,
} from "../spread.js";
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

describe("alignAndComputeSpread", () => {
  it("computes log ratio spread for matching dates", () => {
    const btc = [mkBar(0, 50000), mkBar(1, 55000)];
    const eth = [mkBar(0, 3000), mkBar(1, 3500)];
    const spreads = alignAndComputeSpread(btc, eth);
    expect(spreads).toHaveLength(2);
    expect(spreads[0].spread).toBeCloseTo(Math.log(50000) - Math.log(3000), 8);
    expect(spreads[1].spread).toBeCloseTo(Math.log(55000) - Math.log(3500), 8);
    expect(spreads[0].btcClose).toBe(50000);
    expect(spreads[0].ethClose).toBe(3000);
    expect(spreads[0].zScore).toBeNull();
  });

  it("drops dates present in only one asset", () => {
    const btc = [mkBar(0, 50000), mkBar(1, 51000), mkBar(2, 52000)];
    const eth = [mkBar(0, 3000), mkBar(2, 3100)];
    const spreads = alignAndComputeSpread(btc, eth);
    expect(spreads).toHaveLength(2);
    expect(spreads[0].date.getTime()).toBe(btc[0].date.getTime());
    expect(spreads[1].date.getTime()).toBe(btc[2].date.getTime());
  });

  it("drops rows with non-positive closes (defensive)", () => {
    const btc = [mkBar(0, 50000), mkBar(1, 0)];
    const eth = [mkBar(0, 3000), mkBar(1, 3100)];
    const spreads = alignAndComputeSpread(btc, eth);
    expect(spreads).toHaveLength(1);
  });

  it("returns [] when no date overlap", () => {
    const btc = [mkBar(0, 50000)];
    const eth = [mkBar(10, 3000)];
    expect(alignAndComputeSpread(btc, eth)).toEqual([]);
  });
});

describe("computeRollingZScore", () => {
  function mkSpreads(values: number[]): SpreadBar[] {
    return values.map((v, i) => ({
      date: new Date(Date.UTC(2024, 0, 1) + i * DAY_MS),
      btcClose: 0,
      ethClose: 0,
      spread: v,
      zScore: null,
      mean: null,
      std: null,
    }));
  }

  it("throws when lookback <= 1", () => {
    expect(() => computeRollingZScore(mkSpreads([1, 2, 3]), 1)).toThrow();
    expect(() => computeRollingZScore(mkSpreads([1, 2, 3]), 0)).toThrow();
  });

  it("first (lookback-1) entries remain null", () => {
    const spreads = mkSpreads([1, 2, 3, 4, 5]);
    computeRollingZScore(spreads, 3);
    expect(spreads[0].zScore).toBeNull();
    expect(spreads[1].zScore).toBeNull();
    expect(spreads[2].zScore).not.toBeNull();
  });

  it("computes correct mean/std for window size 3", () => {
    const spreads = mkSpreads([1, 2, 3]);
    computeRollingZScore(spreads, 3);
    // mean = 2, variance = ((1-2)^2 + (2-2)^2 + (3-2)^2)/3 = 2/3 ≈ 0.8165
    expect(spreads[2].mean).toBeCloseTo(2, 8);
    expect(spreads[2].std).toBeCloseTo(Math.sqrt(2 / 3), 8);
    // z(3) = (3-2)/0.8165 = 1.2247
    expect(spreads[2].zScore).toBeCloseTo((3 - 2) / Math.sqrt(2 / 3), 6);
  });

  it("zScore is null when std=0 (constant spread)", () => {
    const spreads = mkSpreads([5, 5, 5, 5]);
    computeRollingZScore(spreads, 3);
    expect(spreads[2].std).toBe(0);
    expect(spreads[2].zScore).toBeNull();
    expect(spreads[3].zScore).toBeNull();
  });

  it("handles total length < lookback (all nulls)", () => {
    const spreads = mkSpreads([1, 2]);
    computeRollingZScore(spreads, 5);
    expect(spreads.every((s) => s.zScore === null && s.mean === null)).toBe(
      true,
    );
  });

  it("z-score magnitude rises after large deviation from recent flat history", () => {
    // 10 values: 8 flat zeros, then 5 (z computed against 4 zeros + itself)
    const spreads = mkSpreads([0, 0, 0, 0, 0, 0, 0, 0, 5, 10]);
    computeRollingZScore(spreads, 5);
    // at i=7, window = [0,0,0,0,0], std=0 → z=null
    expect(spreads[7].zScore).toBeNull();
    // at i=8, window=[0,0,0,0,5], mean=1, std=2, z=(5-1)/2=2.0
    expect(spreads[8].zScore).toBeCloseTo(2.0, 6);
    // at i=9, window=[0,0,0,5,10], mean=3, std=4, z=(10-3)/4=1.75
    expect(spreads[9].zScore).toBeCloseTo(1.75, 6);
  });
});
