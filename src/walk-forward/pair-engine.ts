import type { DailyBar } from "../types/bar.js";
import {
  runPairBacktest,
  type PairTradeParams,
  type PairBacktestResult,
} from "../backtest/pair-engine.js";

export interface PairWfArgs {
  btcBars: DailyBar[];
  ethBars: DailyBar[];
  paramGrid: { [K in keyof PairTradeParams]?: number[] };
  fixed?: Partial<PairTradeParams>;
  isDays: number;
  oosDays: number;
  stepDays: number;
  initialCapital: number;
}

export interface PairWfWindow {
  windowIndex: number;
  isStart: Date;
  isEnd: Date;
  oosStart: Date;
  oosEnd: Date;
  bestParams: PairTradeParams;
  isSharpe: number;
  oosSharpe: number;
  oosMar: number;
  oosPf: number;
  oosMaxDd: number;
  oosTrades: number;
  oosTotalReturn: number;
}

export interface PairWfAggregate {
  windows: PairWfWindow[];
  oosAvgSharpe: number;
  oosAvgMar: number;
  oosAvgPf: number;
  oosMaxDd: number;
  oosAvgTotalReturn: number;
  isOosSharpeDrop: number;
}

const MIN_TRADE_COUNT = 5;

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
  grid: { [K in keyof PairTradeParams]?: number[] },
  fixed: Partial<PairTradeParams>,
): PairTradeParams[] {
  const keys = Object.keys(grid) as (keyof PairTradeParams)[];
  let combos: Array<Partial<PairTradeParams>> = [{ ...fixed }];
  for (const k of keys) {
    const values = grid[k]!;
    const next: Array<Partial<PairTradeParams>> = [];
    for (const c of combos) {
      for (const v of values) next.push({ ...c, [k]: v });
    }
    combos = next;
  }
  return combos as PairTradeParams[];
}

function sliceSpreadBars(
  bars: DailyBar[],
  start: number,
  end: number,
): DailyBar[] {
  return bars.slice(start, end);
}

function optimizeOnIs(
  btcBars: DailyBar[],
  ethBars: DailyBar[],
  combos: PairTradeParams[],
  initialCapital: number,
): { bestParams: PairTradeParams; bestSharpe: number } {
  const allResults: Array<{
    params: PairTradeParams;
    result: PairBacktestResult;
  }> = [];
  for (const params of combos) {
    const r = runPairBacktest({
      btcBars,
      ethBars,
      params,
      initialCapital,
    });
    allResults.push({ params, result: r });
  }
  const qualified = allResults.filter(
    (r) => r.result.tradeCount >= MIN_TRADE_COUNT,
  );
  const pool = qualified.length > 0 ? qualified : allResults;
  let best = pool[0];
  for (const r of pool) {
    if (normalizeSharpe(r.result.sharpe) > normalizeSharpe(best.result.sharpe)) {
      best = r;
    }
  }
  return { bestParams: best.params, bestSharpe: best.result.sharpe };
}

/**
 * Walk-forward driver for pair trading. Slides IS/OOS window across the
 * aligned BTC-ETH bar series and grid-searches on IS, evaluates on OOS.
 *
 * Note: both BTC and ETH bar series must be pre-aligned (same length,
 * parallel indices = same dates).
 */
export function runPairWalkForward(args: PairWfArgs): PairWfAggregate {
  const {
    btcBars,
    ethBars,
    paramGrid,
    fixed = {},
    isDays,
    oosDays,
    stepDays,
    initialCapital,
  } = args;

  if (btcBars.length !== ethBars.length) {
    throw new Error(
      `pair WF expects aligned bars, got btc=${btcBars.length} eth=${ethBars.length}`,
    );
  }

  const combos = cartesian(paramGrid, fixed);
  const windows: PairWfWindow[] = [];
  const totalBars = btcBars.length;

  for (
    let windowStart = 0, idx = 0;
    windowStart + isDays + oosDays <= totalBars;
    windowStart += stepDays, idx++
  ) {
    const isBtc = sliceSpreadBars(btcBars, windowStart, windowStart + isDays);
    const isEth = sliceSpreadBars(ethBars, windowStart, windowStart + isDays);
    const oosBtc = sliceSpreadBars(
      btcBars,
      windowStart + isDays,
      windowStart + isDays + oosDays,
    );
    const oosEth = sliceSpreadBars(
      ethBars,
      windowStart + isDays,
      windowStart + isDays + oosDays,
    );

    const opt = optimizeOnIs(isBtc, isEth, combos, initialCapital);
    const oos = runPairBacktest({
      btcBars: oosBtc,
      ethBars: oosEth,
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
