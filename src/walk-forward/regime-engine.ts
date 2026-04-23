import type { DailyBar } from "../types/bar.js";
import type { OnchainBar } from "../data/onchain-loader.js";
import {
  runRegimeBacktest,
  type RegimeParams,
  type RegimeBacktestResult,
} from "../backtest/regime-engine.js";

export interface RegimeWfArgs {
  btcBars: DailyBar[];
  onchainBars: OnchainBar[];
  paramGrid: { [K in keyof RegimeParams]?: number[] };
  fixed?: Partial<RegimeParams>;
  isDays: number;
  oosDays: number;
  stepDays: number;
  initialCapital: number;
}

export interface RegimeWfWindow {
  windowIndex: number;
  isStart: Date;
  isEnd: Date;
  oosStart: Date;
  oosEnd: Date;
  bestParams: RegimeParams;
  isSharpe: number;
  oosSharpe: number;
  oosMar: number;
  oosPf: number;
  oosMaxDd: number;
  oosTrades: number;
  oosTotalReturn: number;
}

export interface RegimeWfAggregate {
  windows: RegimeWfWindow[];
  oosAvgSharpe: number;
  oosAvgMar: number;
  oosAvgPf: number;
  oosMaxDd: number;
  oosAvgTotalReturn: number;
  isOosSharpeDrop: number;
}

const MIN_TRADE_COUNT = 2; // regime strategies trade less often

function safeKpi(n: number, max = 10): number {
  if (Number.isNaN(n)) return 0;
  if (n === Infinity) return max;
  if (n === -Infinity) return -max;
  return n;
}

function average(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function normalizeSharpe(s: number): number {
  if (Number.isNaN(s)) return Number.NEGATIVE_INFINITY;
  if (s === Infinity) return Number.MAX_SAFE_INTEGER;
  if (s === -Infinity) return Number.NEGATIVE_INFINITY;
  return s;
}

function cartesian(
  grid: { [K in keyof RegimeParams]?: number[] },
  fixed: Partial<RegimeParams>,
): RegimeParams[] {
  const keys = Object.keys(grid) as (keyof RegimeParams)[];
  let combos: Array<Partial<RegimeParams>> = [{ ...fixed }];
  for (const k of keys) {
    const values = grid[k]!;
    const next: Array<Partial<RegimeParams>> = [];
    for (const c of combos) for (const v of values) next.push({ ...c, [k]: v });
    combos = next;
  }
  return combos as RegimeParams[];
}

function sliceWindow<T extends { date: Date }>(
  bars: T[],
  startDate: Date,
  endDate: Date,
): T[] {
  return bars.filter(
    (b) => b.date >= startDate && b.date <= endDate,
  );
}

function optimizeOnIs(
  btcBars: DailyBar[],
  onchainBars: OnchainBar[],
  combos: RegimeParams[],
  initialCapital: number,
): { bestParams: RegimeParams; bestSharpe: number } {
  const all: Array<{ params: RegimeParams; result: RegimeBacktestResult }> = [];
  for (const params of combos) {
    const r = runRegimeBacktest({
      btcBars,
      onchainBars,
      params,
      initialCapital,
    });
    all.push({ params, result: r });
  }
  const qualified = all.filter((r) => r.result.tradeCount >= MIN_TRADE_COUNT);
  const pool = qualified.length > 0 ? qualified : all;
  let best = pool[0];
  for (const r of pool) {
    if (normalizeSharpe(r.result.sharpe) > normalizeSharpe(best.result.sharpe)) {
      best = r;
    }
  }
  return { bestParams: best.params, bestSharpe: best.result.sharpe };
}

/**
 * WF driver for on-chain regime strategy. Both btcBars and onchainBars must
 * cover at least `isDays + oosDays + stepDays × (windows-1)` days.
 *
 * Note: Unlike engine.ts's index-based slicing, this uses date-based slicing
 * because btcBars and onchainBars might have different lengths due to
 * weekend/holiday differences (though crypto is 24/7, defensive).
 */
export function runRegimeWalkForward(args: RegimeWfArgs): RegimeWfAggregate {
  const {
    btcBars,
    onchainBars,
    paramGrid,
    fixed = {},
    isDays,
    oosDays,
    stepDays,
    initialCapital,
  } = args;

  if (btcBars.length === 0 || onchainBars.length === 0) {
    return {
      windows: [],
      oosAvgSharpe: 0,
      oosAvgMar: 0,
      oosAvgPf: 0,
      oosMaxDd: 0,
      oosAvgTotalReturn: 0,
      isOosSharpeDrop: 0,
    };
  }

  const combos = cartesian(paramGrid, fixed);
  const windows: RegimeWfWindow[] = [];
  const DAY_MS = 24 * 60 * 60 * 1000;
  const firstDate = btcBars[0].date;
  const lastDate = btcBars[btcBars.length - 1].date;
  const totalDays =
    Math.floor((lastDate.getTime() - firstDate.getTime()) / DAY_MS) + 1;

  let idx = 0;
  for (
    let startDay = 0;
    startDay + isDays + oosDays <= totalDays;
    startDay += stepDays
  ) {
    const isStart = new Date(firstDate.getTime() + startDay * DAY_MS);
    const isEnd = new Date(
      firstDate.getTime() + (startDay + isDays - 1) * DAY_MS,
    );
    const oosStart = new Date(
      firstDate.getTime() + (startDay + isDays) * DAY_MS,
    );
    const oosEnd = new Date(
      firstDate.getTime() + (startDay + isDays + oosDays - 1) * DAY_MS,
    );

    const isBtc = sliceWindow(btcBars, isStart, isEnd);
    const oosBtc = sliceWindow(btcBars, oosStart, oosEnd);

    if (isBtc.length === 0 || oosBtc.length === 0) {
      idx++;
      continue;
    }

    // Pass full onchain history up through window end so percentile / MA
    // warm-up uses pre-window data. Features aligned by date in engine.
    const isOnFull = sliceWindow(onchainBars, onchainBars[0].date, isEnd);
    const oosOnFull = sliceWindow(onchainBars, onchainBars[0].date, oosEnd);

    const opt = optimizeOnIs(isBtc, isOnFull, combos, initialCapital);
    const oos = runRegimeBacktest({
      btcBars: oosBtc,
      onchainBars: oosOnFull,
      params: opt.bestParams,
      initialCapital,
    });

    windows.push({
      windowIndex: idx,
      isStart: isBtc[0].date,
      isEnd: isBtc[isBtc.length - 1].date,
      oosStart: oosBtc[0].date,
      oosEnd: oosBtc[oosBtc.length - 1].date,
      bestParams: opt.bestParams,
      isSharpe: safeKpi(opt.bestSharpe),
      oosSharpe: safeKpi(oos.sharpe),
      oosMar: safeKpi(oos.mar),
      oosPf: safeKpi(oos.profitFactor),
      oosMaxDd: oos.maxDrawdown,
      oosTrades: oos.tradeCount,
      oosTotalReturn: oos.totalReturn,
    });
    idx++;
  }

  if (windows.length === 0) {
    return {
      windows: [],
      oosAvgSharpe: 0,
      oosAvgMar: 0,
      oosAvgPf: 0,
      oosMaxDd: 0,
      oosAvgTotalReturn: 0,
      isOosSharpeDrop: 0,
    };
  }

  const oosAvgSharpe = average(windows.map((w) => w.oosSharpe));
  const oosAvgMar = average(windows.map((w) => w.oosMar));
  const oosAvgPf = average(windows.map((w) => w.oosPf));
  const oosMaxDd = Math.max(...windows.map((w) => w.oosMaxDd));
  const oosAvgTotalReturn = average(windows.map((w) => w.oosTotalReturn));
  const isAvgSharpe = average(windows.map((w) => w.isSharpe));
  const isOosSharpeDrop =
    isAvgSharpe > 0 ? (isAvgSharpe - oosAvgSharpe) / isAvgSharpe : 0;

  return {
    windows,
    oosAvgSharpe,
    oosAvgMar,
    oosAvgPf,
    oosMaxDd,
    oosAvgTotalReturn,
    isOosSharpeDrop,
  };
}
