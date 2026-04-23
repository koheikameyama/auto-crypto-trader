import type { DailyBar } from "../types/bar.js";
import type { OnchainBar } from "../data/onchain-loader.js";
import {
  computeOnchainFeatures,
  type OnchainFeatureBar,
} from "../lib/onchain-indicators.js";
import { applyFee } from "./cost-model.js";
import {
  sharpeRatio,
  maxDrawdown,
  profitFactor,
  expectancy,
  marRatio,
  annualReturn,
  winRate,
} from "../lib/metrics.js";
import type { EquityPoint } from "./engine.js";

export interface RegimeParams extends Record<string, number> {
  nvtLookback: number;
  nvtPercentile: number;
  aaLookback: number;
  aaMomentumThreshold: number;
  percentileWindow: number;
}

export const regimeDefaults: RegimeParams = {
  nvtLookback: 14,
  nvtPercentile: 0.7,
  aaLookback: 30,
  aaMomentumThreshold: 1.0,
  percentileWindow: 365,
};

export type RegimeExitReason = "regime_bear" | "end_of_data";

export interface RegimeTrade {
  entryDate: Date;
  entryPrice: number;
  exitDate: Date;
  exitPrice: number;
  exitReason: RegimeExitReason;
  btcUnits: number;
  pnlUsd: number;
  holdingDays: number;
}

export interface RegimeBacktestResult {
  trades: RegimeTrade[];
  equityCurve: EquityPoint[];
  totalReturn: number;
  sharpe: number;
  mar: number;
  profitFactor: number;
  maxDrawdown: number;
  winRate: number;
  expectancy: number;
  tradeCount: number;
}

export interface RegimeBacktestInput {
  btcBars: DailyBar[];
  onchainBars: OnchainBar[];
  params: RegimeParams;
  initialCapital: number;
  /**
   * 事前計算された feature 系列（optional）。指定された場合、onchainBars から
   * feature を計算せず、この配列を date で突合して使う。
   * WF のように「full history で feature 計算 → window ごとに backtest」する
   * パターンで warm-up を回避するために使う。
   */
  precomputedFeatures?: OnchainFeatureBar[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

function isBullish(feat: OnchainFeatureBar, p: RegimeParams): boolean {
  if (feat.nvtPercentile === null) return false;
  if (feat.aaMomentum === null) return false;
  return (
    feat.nvtPercentile < p.nvtPercentile &&
    feat.aaMomentum > p.aaMomentumThreshold
  );
}

function empty(): RegimeBacktestResult {
  return {
    trades: [],
    equityCurve: [],
    totalReturn: 0,
    sharpe: 0,
    mar: 0,
    profitFactor: 0,
    maxDrawdown: 0,
    winRate: 0,
    expectancy: 0,
    tradeCount: 0,
  };
}

/**
 * Regime-filtered BH backtest. Binary long/cash switching based on on-chain
 * regime signal. Fees applied at each regime transition (entry/exit).
 *
 * Position sizing: all-in / all-out (use full cash on entry, close full units
 * on exit). This models a retail investor who rotates between BTC and USD cash
 * based on macro indicators.
 *
 * PnL on close = (effExit - entryPrice) * btcUnits; fees already baked into
 * both effEntry and effExit via applyFee.
 */
export function runRegimeBacktest(
  input: RegimeBacktestInput,
): RegimeBacktestResult {
  const { btcBars, onchainBars, params, initialCapital, precomputedFeatures } = input;

  if (btcBars.length === 0) return empty();
  if (!precomputedFeatures && onchainBars.length === 0) return empty();

  // Use precomputed features if provided, else compute from onchainBars
  const feats =
    precomputedFeatures ??
    computeOnchainFeatures(onchainBars, {
      nvtLookback: params.nvtLookback,
      aaLookback: params.aaLookback,
      percentileWindow: params.percentileWindow,
    });
  const featByTime = new Map<number, OnchainFeatureBar>();
  for (const f of feats) featByTime.set(f.date.getTime(), f);

  let cash = initialCapital;
  let holding: {
    entryDate: Date;
    entryPrice: number; // effective (post-fee)
    btcUnits: number;
  } | null = null;

  const trades: RegimeTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  for (const bar of btcBars) {
    const feat = featByTime.get(bar.date.getTime());
    // No feature for this date → can't judge regime, carry state
    const bullish = feat ? isBullish(feat, params) : false;

    // 1. Exit: currently holding but regime turned bearish (or no data)
    if (holding !== null && !bullish) {
      const daysHeld = daysBetween(holding.entryDate, bar.date);
      const effExit = applyFee("BTC-USD", "long", "exit", bar.close);
      const pnl = (effExit - holding.entryPrice) * holding.btcUnits;
      trades.push({
        entryDate: holding.entryDate,
        entryPrice: holding.entryPrice,
        exitDate: bar.date,
        exitPrice: effExit,
        exitReason: "regime_bear",
        btcUnits: holding.btcUnits,
        pnlUsd: pnl,
        holdingDays: daysHeld,
      });
      cash = holding.btcUnits * effExit;
      holding = null;
    }

    // 2. Entry: no position but regime turned bullish
    if (holding === null && bullish) {
      const effEntry = applyFee("BTC-USD", "long", "entry", bar.close);
      const btcUnits = cash / effEntry;
      holding = {
        entryDate: bar.date,
        entryPrice: effEntry,
        btcUnits,
      };
      cash = 0;
    }

    // 3. Mark to market
    const equity =
      holding !== null
        ? holding.btcUnits * bar.close // MtM (ignore fee for unrealized)
        : cash;
    equityCurve.push({ date: bar.date, equity });
  }

  // Force close at end
  if (holding !== null) {
    const last = btcBars[btcBars.length - 1];
    const daysHeld = daysBetween(holding.entryDate, last.date);
    const effExit = applyFee("BTC-USD", "long", "exit", last.close);
    const pnl = (effExit - holding.entryPrice) * holding.btcUnits;
    trades.push({
      entryDate: holding.entryDate,
      entryPrice: holding.entryPrice,
      exitDate: last.date,
      exitPrice: effExit,
      exitReason: "end_of_data",
      btcUnits: holding.btcUnits,
      pnlUsd: pnl,
      holdingDays: daysHeld,
    });
    cash = holding.btcUnits * effExit;
    holding = null;
    if (equityCurve.length > 0) {
      equityCurve[equityCurve.length - 1] = {
        date: last.date,
        equity: cash,
      };
    }
  }

  const finalEquity =
    equityCurve.length > 0
      ? equityCurve[equityCurve.length - 1].equity
      : initialCapital;
  const totalReturn = (finalEquity - initialCapital) / initialCapital;

  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev !== 0) returns.push((equityCurve[i].equity - prev) / prev);
  }
  const sharpe = sharpeRatio(returns);
  const mdd = maxDrawdown(equityCurve.map((p) => p.equity));
  const first = equityCurve[0]?.date ?? btcBars[0].date;
  const lastDate =
    equityCurve[equityCurve.length - 1]?.date ?? btcBars[btcBars.length - 1].date;
  const years = (lastDate.getTime() - first.getTime()) / (365.25 * DAY_MS);
  const mar = marRatio(annualReturn(totalReturn, years), mdd);

  const pnls = trades.map((t) => t.pnlUsd);
  return {
    trades,
    equityCurve,
    totalReturn,
    sharpe,
    mar,
    profitFactor: profitFactor(pnls),
    maxDrawdown: mdd,
    winRate: winRate(pnls),
    expectancy: expectancy(pnls),
    tradeCount: trades.length,
  };
}
