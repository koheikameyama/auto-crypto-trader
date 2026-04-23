import { describe, it, expect } from "vitest";
import { runBacktest } from "../engine.js";
import type { DailyBar } from "../../types/bar.js";
import type { EntrySignal } from "../../types/signal.js";
import type { Strategy, ExitConfig } from "../../types/strategy.js";

function mkDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

function bar(
  date: Date,
  open: number,
  high: number,
  low: number,
  close: number,
): DailyBar {
  return { date, open, high, low, close, volume: null };
}

function mockStrategy(
  signals: EntrySignal[],
  exitCfg?: Partial<ExitConfig>,
): Strategy<Record<string, unknown>> {
  return {
    name: "mock",
    defaultParams: {},
    exitConfig: {
      useTrailing: true,
      timeStopDays: 100,
      timeStopMaxDays: 200,
      slAtrMultiplier: 1.0,
      beAtrMultiplier: 0.5,
      trailAtrMultiplier: 1.0,
      ...exitCfg,
    },
    generateSignals: () => signals,
  };
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
  const dayMs = 24 * 60 * 60 * 1000;
  for (let i = 0; i < days; i++) {
    const d = new Date(base + i * dayMs);
    const p = startPrice + step * i;
    bars.push(bar(d, p, p + 5, p - 5, p));
  }
  return bars;
}

describe("runBacktest", () => {
  it("handles empty bars input with zero KPIs", () => {
    const strat = mockStrategy([]);
    const result = runBacktest({
      bars: [],
      asset: "BTC-USD",
      strategy: strat,
      params: {},
      initialCapital: 10_000,
      riskRatio: 0.01,
    });

    expect(result.trades).toHaveLength(0);
    expect(result.equityCurve).toHaveLength(0);
    expect(result.totalReturn).toBe(0);
    expect(result.sharpe).toBe(0);
    expect(result.mar).toBe(0);
    expect(result.profitFactor).toBe(0);
    expect(result.maxDrawdown).toBe(0);
    expect(result.winRate).toBe(0);
    expect(result.expectancy).toBe(0);
    expect(result.tradeCount).toBe(0);
  });

  it("produces flat equity curve when no signals are generated", () => {
    const strat = mockStrategy([]);
    const bars: DailyBar[] = [];
    const base = mkDate("2024-01-01").getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    for (let i = 0; i < 10; i++) {
      const d = new Date(base + i * dayMs);
      bars.push(bar(d, 50_000, 50_500, 49_500, 50_000));
    }

    const result = runBacktest({
      bars,
      asset: "BTC-USD",
      strategy: strat,
      params: {},
      initialCapital: 10_000,
      riskRatio: 0.01,
    });

    expect(result.trades).toHaveLength(0);
    expect(result.equityCurve).toHaveLength(10);
    for (const pt of result.equityCurve) {
      expect(pt.equity).toBe(10_000);
    }
    expect(result.totalReturn).toBe(0);
    expect(result.tradeCount).toBe(0);
  });

  it("records a winning long trade when price rises and time stop exits", () => {
    // 30 bars rising from 50000 -> 60000, timeStopDays=20
    const bars = makeRisingBars("2024-01-01", 50_000, 60_000, 30);
    const signals: EntrySignal[] = [
      {
        date: bars[0].date,
        asset: "BTC-USD",
        side: "long",
        entryPrice: 50_000,
        atr: 500,
      },
    ];
    const strat = mockStrategy(signals, { timeStopDays: 20 });

    const result = runBacktest({
      bars,
      asset: "BTC-USD",
      strategy: strat,
      params: {},
      initialCapital: 10_000,
      riskRatio: 0.01,
    });

    expect(result.trades).toHaveLength(1);
    const t = result.trades[0];
    expect(t.side).toBe("long");
    expect(t.asset).toBe("BTC-USD");
    expect(t.pnlUsd).toBeGreaterThan(0);
    expect(t.holdingDays).toBeGreaterThan(0);
    const finalEquity = result.equityCurve[result.equityCurve.length - 1].equity;
    expect(finalEquity).toBeGreaterThan(10_000);
    expect(result.totalReturn).toBeGreaterThan(0);
  });

  it("exits at stop loss when price drops sharply", () => {
    const base = mkDate("2024-01-01").getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const bars: DailyBar[] = [];
    // Day 0: entry at 50000
    bars.push(bar(new Date(base), 50_000, 50_300, 49_700, 50_000));
    // Day 1: sharp drop touching SL (entry ~50050 with fee, SL = 50050 - 500 = 49550)
    bars.push(bar(new Date(base + dayMs), 49_800, 49_900, 48_000, 48_500));
    for (let i = 2; i < 5; i++) {
      bars.push(bar(new Date(base + i * dayMs), 48_500, 48_800, 48_200, 48_500));
    }

    const signals: EntrySignal[] = [
      {
        date: bars[0].date,
        asset: "BTC-USD",
        side: "long",
        entryPrice: 50_000,
        atr: 500,
      },
    ];
    const strat = mockStrategy(signals, { timeStopDays: 100 });

    const result = runBacktest({
      bars,
      asset: "BTC-USD",
      strategy: strat,
      params: {},
      initialCapital: 10_000,
      riskRatio: 0.01,
    });

    expect(result.trades).toHaveLength(1);
    const t = result.trades[0];
    expect(t.side).toBe("long");
    expect(t.exitReason).toBe("sl");
    expect(t.pnlUsd).toBeLessThan(0);
  });

  it("produces trade with exitReason='time' when time stop triggers", () => {
    const base = mkDate("2024-01-01").getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const bars: DailyBar[] = [];
    for (let i = 0; i < 10; i++) {
      bars.push(bar(new Date(base + i * dayMs), 50_000, 50_050, 49_950, 50_000));
    }

    const signals: EntrySignal[] = [
      {
        date: bars[0].date,
        asset: "BTC-USD",
        side: "long",
        entryPrice: 50_000,
        atr: 500,
      },
    ];
    const strat = mockStrategy(signals, { timeStopDays: 5 });

    const result = runBacktest({
      bars,
      asset: "BTC-USD",
      strategy: strat,
      params: {},
      initialCapital: 10_000,
      riskRatio: 0.01,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("time");
  });

  it("force-closes an open position at end of data", () => {
    const bars = makeRisingBars("2024-01-01", 50_000, 50_500, 5);
    const signals: EntrySignal[] = [
      {
        date: bars[0].date,
        asset: "BTC-USD",
        side: "long",
        entryPrice: 50_000,
        atr: 500,
      },
    ];
    const strat = mockStrategy(signals, {
      timeStopDays: 100,
      timeStopMaxDays: 200,
    });

    const result = runBacktest({
      bars,
      asset: "BTC-USD",
      strategy: strat,
      params: {},
      initialCapital: 10_000,
      riskRatio: 0.01,
    });

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitReason).toBe("end_of_data");
    expect(result.trades[0].exitDate.getTime()).toBe(
      bars[bars.length - 1].date.getTime(),
    );
  });

  it("fee reduces PnL: long round-trip at same price yields negative PnL", () => {
    const base = mkDate("2024-01-01").getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const bars: DailyBar[] = [];
    // Flat 50000 price; time stop exits at same close → only fee cost remains
    for (let i = 0; i < 6; i++) {
      bars.push(bar(new Date(base + i * dayMs), 50_000, 50_050, 49_950, 50_000));
    }
    const signals: EntrySignal[] = [
      {
        date: bars[0].date,
        asset: "BTC-USD",
        side: "long",
        entryPrice: 50_000,
        atr: 500,
      },
    ];
    const strat = mockStrategy(signals, { timeStopDays: 5 });
    const result = runBacktest({
      bars,
      asset: "BTC-USD",
      strategy: strat,
      params: {},
      initialCapital: 10_000,
      riskRatio: 0.01,
    });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].pnlUsd).toBeLessThan(0);
  });

  it("funding rate: long with positive annualFundingRate reduces PnL vs zero funding", () => {
    const bars = makeRisingBars("2024-01-01", 50_000, 55_000, 30);
    const signals: EntrySignal[] = [
      {
        date: bars[0].date,
        asset: "BTC-USD",
        side: "long",
        entryPrice: 50_000,
        atr: 500,
      },
    ];
    const strat = mockStrategy(signals, { timeStopDays: 20 });

    const zeroFunding = runBacktest({
      bars,
      asset: "BTC-USD",
      strategy: strat,
      params: {},
      initialCapital: 10_000,
      riskRatio: 0.01,
      annualFundingRate: 0,
    });
    const posFunding = runBacktest({
      bars,
      asset: "BTC-USD",
      strategy: strat,
      params: {},
      initialCapital: 10_000,
      riskRatio: 0.01,
      annualFundingRate: 0.1,
    });

    expect(posFunding.trades[0].pnlUsd).toBeLessThan(zeroFunding.trades[0].pnlUsd);
  });
});
