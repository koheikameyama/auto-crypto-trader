import type { DailyBar } from "../types/bar.js";
import type { OnchainBar } from "../data/onchain-loader.js";
import {
  computeOnchainFeatures,
  type OnchainFeatureBar,
} from "../lib/onchain-indicators.js";
import { forwardFillMacro } from "../data/macro-loader.js";
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

export interface ContinuousParams extends Record<string, number> {
  // Onchain
  nvtLookback: number;
  aaLookback: number;
  percentileWindow: number;
  // Macro
  dxySmaPeriod: number;
  vixThreshold: number;
  /** 動的リバランス発動閾値 (Δposition > this で transact)。無駄コストを抑える */
  rebalanceThreshold: number;
}

export const continuousDefaults: ContinuousParams = {
  nvtLookback: 14,
  aaLookback: 30,
  percentileWindow: 365,
  dxySmaPeriod: 200,
  vixThreshold: 30,
  rebalanceThreshold: 0.1,
};

export interface ContinuousTrade {
  date: Date;
  price: number;
  prevPosition: number; // 0-1
  newPosition: number; // 0-1
  btcUnitsDelta: number;
  feeUsd: number;
}

export interface ContinuousResult {
  trades: ContinuousTrade[];
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

export interface ContinuousInput {
  btcBars: DailyBar[];
  onchainBars: OnchainBar[];
  dxyBars: DailyBar[];
  vixBars: DailyBar[];
  params: ContinuousParams;
  initialCapital: number;
  precomputedFeatures?: OnchainFeatureBar[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function simpleMa(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period];
    out[i] = sum / period;
  }
  return out;
}

/**
 * Compute a target position (0-1) from the three signals using a weighted
 * soft vote. Each signal contributes 1/3 when bullish, linearly interpolated
 * near thresholds.
 */
function computeTargetPosition(
  feat: OnchainFeatureBar | undefined,
  dxy: number | null,
  dxyMa: number | null,
  vix: number | null,
  vixThreshold: number,
): number {
  // Onchain score: mix of nvt_percentile and aa_momentum
  let onchainScore = 0;
  if (feat && feat.nvtPercentile !== null && feat.aaMomentum !== null) {
    // nvt low = bullish (undervalued). Map percentile [0,1] → score [1,0]
    const nvtScore = 1 - feat.nvtPercentile;
    // aa momentum > 1 = bullish. Clamp 0.8..1.2 → 0..1
    const aaScore = Math.max(0, Math.min(1, (feat.aaMomentum - 0.8) / 0.4));
    onchainScore = (nvtScore + aaScore) / 2;
  }

  // DXY score: 1 if DXY well below SMA, 0 if well above
  let dxyScore = 0.5; // default neutral
  if (dxy !== null && dxyMa !== null && dxyMa > 0) {
    const ratio = dxy / dxyMa;
    // ratio < 0.97 → bullish (crypto-friendly), > 1.03 → bearish
    if (ratio < 0.97) dxyScore = 1;
    else if (ratio > 1.03) dxyScore = 0;
    else dxyScore = (1.03 - ratio) / 0.06;
  }

  // VIX score: 1 if low, 0 if above threshold
  let vixScore = 0.5;
  if (vix !== null) {
    if (vix < vixThreshold * 0.7) vixScore = 1;
    else if (vix > vixThreshold * 1.3) vixScore = 0;
    else vixScore = 1 - (vix - vixThreshold * 0.7) / (vixThreshold * 0.6);
  }

  // Combined: simple average
  return (onchainScore + dxyScore + vixScore) / 3;
}

function empty(): ContinuousResult {
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
 * Continuous position sizing backtest.
 *
 * Each day:
 *   1. Compute target position (0..1) from onchain + DXY + VIX soft scores
 *   2. If |new - current| > rebalanceThreshold, rebalance with fee
 *   3. Current position value marked to market
 *
 * Final PnL = equity curve last value - initialCapital.
 */
export function runContinuousBacktest(
  input: ContinuousInput,
): ContinuousResult {
  const {
    btcBars,
    onchainBars,
    dxyBars,
    vixBars,
    params,
    initialCapital,
    precomputedFeatures,
  } = input;

  if (btcBars.length === 0) return empty();

  const feats =
    precomputedFeatures ??
    computeOnchainFeatures(onchainBars, {
      nvtLookback: params.nvtLookback,
      aaLookback: params.aaLookback,
      percentileWindow: params.percentileWindow,
    });
  const featByTime = new Map<number, OnchainFeatureBar>();
  for (const f of feats) featByTime.set(f.date.getTime(), f);

  const btcDates = btcBars.map((b) => b.date);
  const dxyAligned = forwardFillMacro(dxyBars, btcDates);
  const vixAligned = forwardFillMacro(vixBars, btcDates);
  const dxyValid = dxyAligned.map((v) => (v === null ? 0 : v));
  const dxySmaRaw = simpleMa(dxyValid, params.dxySmaPeriod);
  const dxySma = dxySmaRaw.map((v, i) => (dxyAligned[i] === null ? null : v));

  let cash = initialCapital;
  let btcUnits = 0;
  let currentPosition = 0; // 0-1 target fraction
  const trades: ContinuousTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  for (let i = 0; i < btcBars.length; i++) {
    const bar = btcBars[i];
    const feat = featByTime.get(bar.date.getTime());
    const target = computeTargetPosition(
      feat,
      dxyAligned[i],
      dxySma[i],
      vixAligned[i],
      params.vixThreshold,
    );

    // Rebalance if delta exceeds threshold
    if (Math.abs(target - currentPosition) > params.rebalanceThreshold) {
      const equityNow = cash + btcUnits * bar.close;
      const targetBtcValue = equityNow * target;
      const currentBtcValue = btcUnits * bar.close;
      const delta = targetBtcValue - currentBtcValue;

      if (delta > 0) {
        // Buy more BTC: long entry fee applies
        const effPrice = applyFee("BTC-USD", "long", "entry", bar.close);
        const unitsToBuy = delta / effPrice;
        btcUnits += unitsToBuy;
        const cashSpent = unitsToBuy * effPrice;
        cash -= cashSpent;
        trades.push({
          date: bar.date,
          price: effPrice,
          prevPosition: currentPosition,
          newPosition: target,
          btcUnitsDelta: unitsToBuy,
          feeUsd: cashSpent - unitsToBuy * bar.close,
        });
      } else {
        // Sell BTC: long exit fee applies
        const effPrice = applyFee("BTC-USD", "long", "exit", bar.close);
        const unitsToSell = -delta / bar.close;
        const actualUnitsToSell = Math.min(btcUnits, unitsToSell);
        btcUnits -= actualUnitsToSell;
        const cashReceived = actualUnitsToSell * effPrice;
        cash += cashReceived;
        trades.push({
          date: bar.date,
          price: effPrice,
          prevPosition: currentPosition,
          newPosition: target,
          btcUnitsDelta: -actualUnitsToSell,
          feeUsd: actualUnitsToSell * bar.close - cashReceived,
        });
      }
      currentPosition = target;
    }

    const equity = cash + btcUnits * bar.close;
    equityCurve.push({ date: bar.date, equity });
  }

  // KPIs
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
    equityCurve[equityCurve.length - 1]?.date ??
    btcBars[btcBars.length - 1].date;
  const years = (lastDate.getTime() - first.getTime()) / (365.25 * DAY_MS);
  const mar = marRatio(annualReturn(totalReturn, years), mdd);

  // For continuous sizing, "trades" are rebalance events. PnL per trade not
  // well-defined; we compute pseudo-pnl as equity change between rebalances.
  // Simpler: reuse equity returns for PF/WR/expectancy (daily basis).
  const dailyPnls = returns.map((r, idx) => r * equityCurve[idx].equity);

  return {
    trades,
    equityCurve,
    totalReturn,
    sharpe,
    mar,
    profitFactor: profitFactor(dailyPnls),
    maxDrawdown: mdd,
    winRate: winRate(dailyPnls),
    expectancy: expectancy(dailyPnls),
    tradeCount: trades.length,
  };
}
