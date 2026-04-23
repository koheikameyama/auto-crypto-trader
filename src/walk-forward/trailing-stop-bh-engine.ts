import type { DailyBar } from "../types/bar.js";
import {
  runTrailingStopBh,
  type TrailingStopBhParams,
  type TrailingStopBacktestResult,
} from "../backtest/trailing-stop-bh-engine.js";

export interface TsbhWfArgs {
  btcBars: DailyBar[];
  paramGrid: { [K in keyof TrailingStopBhParams]?: number[] };
  isDays: number;
  oosDays: number;
  stepDays: number;
  initialCapital: number;
}

export interface TsbhWfWindow {
  windowIndex: number;
  isStart: Date;
  isEnd: Date;
  oosStart: Date;
  oosEnd: Date;
  bestParams: TrailingStopBhParams;
  isSharpe: number;
  oosSharpe: number;
  oosMar: number;
  oosPf: number;
  oosMaxDd: number;
  oosTrades: number;
  oosTotalReturn: number;
}

export interface TsbhWfAggregate {
  windows: TsbhWfWindow[];
  oosAvgSharpe: number;
  oosAvgMar: number;
  oosAvgPf: number;
  oosMaxDd: number;
  oosAvgTotalReturn: number;
  isOosSharpeDrop: number;
}

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
  grid: { [K in keyof TrailingStopBhParams]?: number[] },
): TrailingStopBhParams[] {
  const keys = Object.keys(grid) as (keyof TrailingStopBhParams)[];
  let combos: Array<Partial<TrailingStopBhParams>> = [{}];
  for (const k of keys) {
    const values = grid[k]!;
    const next: Array<Partial<TrailingStopBhParams>> = [];
    for (const c of combos) for (const v of values) next.push({ ...c, [k]: v });
    combos = next;
  }
  return combos as TrailingStopBhParams[];
}

function optimizeOnIs(
  btcBars: DailyBar[],
  combos: TrailingStopBhParams[],
  initialCapital: number,
): { bestParams: TrailingStopBhParams; bestSharpe: number } {
  const all: Array<{
    params: TrailingStopBhParams;
    result: TrailingStopBacktestResult;
  }> = [];
  for (const params of combos) {
    const r = runTrailingStopBh({ btcBars, params, initialCapital });
    all.push({ params, result: r });
  }
  let best = all[0];
  for (const r of all) {
    if (normalizeSharpe(r.result.sharpe) > normalizeSharpe(best.result.sharpe)) {
      best = r;
    }
  }
  return { bestParams: best.params, bestSharpe: best.result.sharpe };
}

export function runTsbhWalkForward(args: TsbhWfArgs): TsbhWfAggregate {
  const { btcBars, paramGrid, isDays, oosDays, stepDays, initialCapital } = args;

  const combos = cartesian(paramGrid);
  const windows: TsbhWfWindow[] = [];
  const totalBars = btcBars.length;

  for (
    let windowStart = 0, idx = 0;
    windowStart + isDays + oosDays <= totalBars;
    windowStart += stepDays, idx++
  ) {
    const isBars = btcBars.slice(windowStart, windowStart + isDays);
    const oosBars = btcBars.slice(
      windowStart + isDays,
      windowStart + isDays + oosDays,
    );
    const opt = optimizeOnIs(isBars, combos, initialCapital);
    const oos = runTrailingStopBh({
      btcBars: oosBars,
      params: opt.bestParams,
      initialCapital,
    });

    windows.push({
      windowIndex: idx,
      isStart: isBars[0].date,
      isEnd: isBars[isBars.length - 1].date,
      oosStart: oosBars[0].date,
      oosEnd: oosBars[oosBars.length - 1].date,
      bestParams: opt.bestParams,
      isSharpe: safeKpi(opt.bestSharpe),
      oosSharpe: safeKpi(oos.sharpe),
      oosMar: safeKpi(oos.mar),
      oosPf: safeKpi(oos.profitFactor),
      oosMaxDd: oos.maxDrawdown,
      oosTrades: oos.tradeCount,
      oosTotalReturn: oos.totalReturn,
    });
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
