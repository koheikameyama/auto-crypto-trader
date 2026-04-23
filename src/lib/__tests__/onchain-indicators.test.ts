import { describe, it, expect } from "vitest";
import {
  computeOnchainFeatures,
  rollingPercentile,
} from "../onchain-indicators.js";
import type { OnchainBar } from "../../data/onchain-loader.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function mkBar(idx: number, params: Partial<OnchainBar> = {}): OnchainBar {
  return {
    date: new Date(Date.UTC(2024, 0, 1) + idx * DAY_MS),
    priceUsd: 50000,
    capMrktUsd: 1e12,
    txCnt: 500_000,
    adrActCnt: 800_000,
    ...params,
  };
}

describe("rollingPercentile", () => {
  it("throws when window <= 1", () => {
    expect(() => rollingPercentile([1, 2, 3], 0)).toThrow();
    expect(() => rollingPercentile([1, 2, 3], 1)).toThrow();
  });

  it("returns null during warm-up", () => {
    const out = rollingPercentile([1, 2, 3, 4, 5], 4);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeNull();
    expect(out[3]).not.toBeNull();
  });

  it("returns fraction <= current in window", () => {
    // Window of [10, 20, 30, 40]. Current = 40, all 4 values are <= 40 → 1.0
    const out = rollingPercentile([10, 20, 30, 40], 4);
    expect(out[3]).toBeCloseTo(1.0, 5);
  });

  it("returns 0.5 when exactly half <= current", () => {
    // Window [10, 20, 30, 40]. Current = 20 (but the function reads at index i).
    // Let me pass a series where the final value is the 2nd smallest
    const out = rollingPercentile([40, 10, 30, 20], 4);
    // At i=3, cur=20, window=[40,10,30,20]. Count of <=20: {10, 20} = 2/4 = 0.5
    expect(out[3]).toBeCloseTo(0.5, 5);
  });

  it("skips null values in window", () => {
    const out = rollingPercentile([10, null, 30, 40], 4);
    // At i=3, cur=40, window=[10, null, 30, 40]. total=3 (excluding null), count=3 → 1.0
    expect(out[3]).toBeCloseTo(1.0, 5);
  });
});

describe("computeOnchainFeatures", () => {
  it("computes nvtProxy as MA of capMrktUsd / txCnt", () => {
    const bars: OnchainBar[] = [];
    for (let i = 0; i < 10; i++) {
      bars.push(
        mkBar(i, {
          capMrktUsd: 1e12 + i * 1e9,
          txCnt: 500_000,
        }),
      );
    }
    const out = computeOnchainFeatures(bars, {
      nvtLookback: 3,
      aaLookback: 3,
      percentileWindow: 5,
    });
    // Raw NVT at i=0: 1e12 / 500_000 = 2e6
    // Raw NVT at i=1: 1.001e12 / 500_000 = 2.002e6
    // Raw NVT at i=2: 1.002e12 / 500_000 = 2.004e6
    // MA(3) at i=2 = (2e6 + 2.002e6 + 2.004e6)/3 = 2.002e6
    expect(out[2].nvtProxy).toBeCloseTo(2.002e6, 0);
    expect(out[0].nvtProxy).toBeNull();
    expect(out[1].nvtProxy).toBeNull();
  });

  it("computes aaMomentum as ratio to MA", () => {
    const bars: OnchainBar[] = [];
    // first 4 bars adr=1_000_000, then ramp up
    for (let i = 0; i < 4; i++) bars.push(mkBar(i, { adrActCnt: 1_000_000 }));
    bars.push(mkBar(4, { adrActCnt: 1_500_000 })); // +50% spike
    const out = computeOnchainFeatures(bars, {
      nvtLookback: 2,
      aaLookback: 3,
      percentileWindow: 2,
    });
    // aa MA at i=4 = (1_000_000 + 1_000_000 + 1_500_000)/3 ≈ 1_166_667
    // aaMomentum at i=4 = 1_500_000 / 1_166_667 ≈ 1.286
    expect(out[4].aaMomentum).toBeCloseTo(1500000 / ((1000000 + 1000000 + 1500000) / 3), 5);
  });

  it("nvtPercentile becomes non-null after percentileWindow bars", () => {
    const bars: OnchainBar[] = [];
    for (let i = 0; i < 20; i++) {
      bars.push(mkBar(i, { capMrktUsd: 1e12 + i * 1e10, txCnt: 500_000 }));
    }
    const out = computeOnchainFeatures(bars, {
      nvtLookback: 3,
      aaLookback: 3,
      percentileWindow: 10,
    });
    // At i=2+, nvtProxy non-null. At i=10 (percentileWindow - 1 + nvtLookback - 1 = 9 + 2 = 11
    // actually percentile looks back 10 bars, needs 10 non-null nvtProxy values
    // First non-null nvt is at i=2, so by i=11 we have 10 valid nvtProxy (i=2..11) → first percentile at i=11
    // Some tolerance
    expect(out[2].nvtPercentile).toBeNull(); // not enough warm-up
    expect(out[15].nvtPercentile).not.toBeNull();
    expect(out[15].nvtPercentile!).toBeGreaterThanOrEqual(0);
    expect(out[15].nvtPercentile!).toBeLessThanOrEqual(1);
  });
});
