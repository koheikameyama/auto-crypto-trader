import { describe, it, expect } from "vitest";
import { runWalkForward } from "../engine.js";
import type { DailyBar } from "../../types/bar.js";
import type { EntrySignal } from "../../types/signal.js";
import type { Strategy } from "../../types/strategy.js";

const DAY_MS = 24 * 60 * 60 * 1000;

function mkDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

function makeBars(
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
    bars.push({
      date: d,
      open: p,
      high: p + 5,
      low: p - 5,
      close: p,
      volume: null,
    });
  }
  return bars;
}

interface TestParams extends Record<string, number> {
  startIndex: number;
  signalGap: number;
}

const testStrategy: Strategy<TestParams> = {
  name: "wf-test",
  defaultParams: { startIndex: 1, signalGap: 5 },
  exitConfig: {
    useTrailing: false,
    timeStopDays: 3,
    timeStopMaxDays: 3,
    slAtrMultiplier: 2.0,
    beAtrMultiplier: 10,
    trailAtrMultiplier: 10,
  },
  generateSignals(bars, asset, params): EntrySignal[] {
    const signals: EntrySignal[] = [];
    for (
      let i = Math.max(1, params.startIndex);
      i < bars.length;
      i += params.signalGap
    ) {
      signals.push({
        date: bars[i].date,
        asset,
        side: "long",
        entryPrice: bars[i].close,
        atr: 500,
      });
    }
    return signals;
  },
};

describe("runWalkForward", () => {
  it("returns empty windows when data is shorter than isDays + oosDays", () => {
    const bars = makeBars("2024-01-01", 50_000, 51_000, 20);
    const agg = runWalkForward({
      strategy: testStrategy,
      bars,
      asset: "BTC-USD",
      paramGrid: { startIndex: [1], signalGap: [5] },
      isDays: 30,
      oosDays: 15,
      stepDays: 15,
      initialCapital: 10_000,
      riskRatio: 0.01,
    });
    expect(agg.windows).toHaveLength(0);
    expect(agg.oosAvgSharpe).toBe(0);
    expect(agg.oosAvgMar).toBe(0);
    expect(agg.oosAvgPf).toBe(0);
    expect(agg.oosMaxDd).toBe(0);
    expect(agg.oosAvgTotalReturn).toBe(0);
    expect(agg.isOosSharpeDrop).toBe(0);
  });

  it("produces exactly 1 window when bars length == isDays + oosDays", () => {
    const isDays = 30;
    const oosDays = 15;
    const bars = makeBars("2024-01-01", 50_000, 60_000, isDays + oosDays);
    const agg = runWalkForward({
      strategy: testStrategy,
      bars,
      asset: "BTC-USD",
      paramGrid: { startIndex: [1], signalGap: [5] },
      isDays,
      oosDays,
      stepDays: 10,
      initialCapital: 10_000,
      riskRatio: 0.01,
    });
    expect(agg.windows).toHaveLength(1);
    const w = agg.windows[0];
    expect(w.windowIndex).toBe(0);
    expect(w.isStart.getTime()).toBe(bars[0].date.getTime());
    expect(w.isEnd.getTime()).toBe(bars[isDays - 1].date.getTime());
    expect(w.oosStart.getTime()).toBe(bars[isDays].date.getTime());
    expect(w.oosEnd.getTime()).toBe(bars[isDays + oosDays - 1].date.getTime());
    expect(w.bestParams.startIndex).toBe(1);
    expect(w.bestParams.signalGap).toBe(5);
  });

  it("produces multiple windows with step advancement", () => {
    const isDays = 30;
    const oosDays = 15;
    const stepDays = 15;
    const bars = makeBars("2024-01-01", 50_000, 70_000, 90);
    const agg = runWalkForward({
      strategy: testStrategy,
      bars,
      asset: "BTC-USD",
      paramGrid: { startIndex: [1], signalGap: [5] },
      isDays,
      oosDays,
      stepDays,
      initialCapital: 10_000,
      riskRatio: 0.01,
    });
    expect(agg.windows).toHaveLength(4);
    for (let i = 0; i < agg.windows.length; i++) {
      expect(agg.windows[i].windowIndex).toBe(i);
    }
    expect(agg.windows[1].isStart.getTime()).toBe(bars[stepDays].date.getTime());
  });

  it("aggregates oosAvgSharpe / oosMaxDd correctly across windows", () => {
    const isDays = 30;
    const oosDays = 15;
    const bars = makeBars("2024-01-01", 50_000, 70_000, 60);
    const agg = runWalkForward({
      strategy: testStrategy,
      bars,
      asset: "BTC-USD",
      paramGrid: { startIndex: [1], signalGap: [5] },
      isDays,
      oosDays,
      stepDays: 15,
      initialCapital: 10_000,
      riskRatio: 0.01,
    });
    expect(agg.windows.length).toBeGreaterThan(0);
    const mean =
      agg.windows.reduce((s, w) => s + w.oosSharpe, 0) / agg.windows.length;
    expect(agg.oosAvgSharpe).toBeCloseTo(mean, 10);
    const worstDd = Math.max(...agg.windows.map((w) => w.oosMaxDd));
    expect(agg.oosMaxDd).toBe(worstDd);
  });

  it("computes isOosSharpeDrop = (isAvg - oosAvg) / isAvg when isAvg > 0", () => {
    const isDays = 30;
    const oosDays = 15;
    const bars = makeBars("2024-01-01", 50_000, 70_000, 60);
    const agg = runWalkForward({
      strategy: testStrategy,
      bars,
      asset: "BTC-USD",
      paramGrid: { startIndex: [1], signalGap: [5] },
      isDays,
      oosDays,
      stepDays: 15,
      initialCapital: 10_000,
      riskRatio: 0.01,
    });
    const isAvg =
      agg.windows.reduce((s, w) => s + w.isSharpe, 0) / agg.windows.length;
    const oosAvg =
      agg.windows.reduce((s, w) => s + w.oosSharpe, 0) / agg.windows.length;
    if (isAvg > 0) {
      expect(agg.isOosSharpeDrop).toBeCloseTo((isAvg - oosAvg) / isAvg, 10);
    } else {
      expect(agg.isOosSharpeDrop).toBe(0);
    }
  });
});
