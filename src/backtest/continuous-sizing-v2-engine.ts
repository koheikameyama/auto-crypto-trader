import type { DailyBar } from "../types/bar.js";
import type { OnchainBar } from "../data/onchain-loader.js";
import type { FundingBar } from "../data/funding-loader.js";
import {
  computeOnchainFeatures,
  rollingPercentile,
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

export interface ContinuousV2Params extends Record<string, number> {
  // Onchain
  nvtLookback: number;
  aaLookback: number;
  percentileWindow: number;
  // Macro
  dxySmaPeriod: number;
  vixThreshold: number;
  // Funding
  fundingLookback: number; // rolling percentile window in days
  // Rebalance
  rebalanceThreshold: number;
}

export const continuousV2Defaults: ContinuousV2Params = {
  nvtLookback: 14,
  aaLookback: 30,
  percentileWindow: 365,
  dxySmaPeriod: 200,
  vixThreshold: 30,
  fundingLookback: 365,
  rebalanceThreshold: 0.1,
};

export interface ContinuousV2Trade {
  date: Date;
  price: number;
  prevPosition: number;
  newPosition: number;
  btcUnitsDelta: number;
  feeUsd: number;
}

export interface ContinuousV2Result {
  trades: ContinuousV2Trade[];
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

export interface ContinuousV2Input {
  btcBars: DailyBar[];
  onchainBars: OnchainBar[];
  dxyBars: DailyBar[];
  vixBars: DailyBar[];
  fundingBars: FundingBar[];
  params: ContinuousV2Params;
  initialCapital: number;
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
 * Compute target position (0-1) from 4 signals (onchain, DXY, VIX, funding).
 * Soft weighted average — each signal contributes 0.25.
 */
function computeTargetPosition(
  feat: OnchainFeatureBar | undefined,
  dxy: number | null,
  dxyMa: number | null,
  vix: number | null,
  vixThreshold: number,
  fundingPct: number | null, // 0..1 rolling percentile of daily funding
): number {
  // Onchain
  let onchainScore = 0;
  if (feat && feat.nvtPercentile !== null && feat.aaMomentum !== null) {
    const nvtScore = 1 - feat.nvtPercentile;
    const aaScore = Math.max(0, Math.min(1, (feat.aaMomentum - 0.8) / 0.4));
    onchainScore = (nvtScore + aaScore) / 2;
  }

  // DXY
  let dxyScore = 0.5;
  if (dxy !== null && dxyMa !== null && dxyMa > 0) {
    const ratio = dxy / dxyMa;
    if (ratio < 0.97) dxyScore = 1;
    else if (ratio > 1.03) dxyScore = 0;
    else dxyScore = (1.03 - ratio) / 0.06;
  }

  // VIX
  let vixScore = 0.5;
  if (vix !== null) {
    if (vix < vixThreshold * 0.7) vixScore = 1;
    else if (vix > vixThreshold * 1.3) vixScore = 0;
    else vixScore = 1 - (vix - vixThreshold * 0.7) / (vixThreshold * 0.6);
  }

  // Funding: low percentile = bullish (few longs, capitulation). High = bearish.
  let fundingScore = 0.5;
  if (fundingPct !== null) {
    fundingScore = 1 - fundingPct;
  }

  return (onchainScore + dxyScore + vixScore + fundingScore) / 4;
}

function empty(): ContinuousV2Result {
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

export function runContinuousV2Backtest(
  input: ContinuousV2Input,
): ContinuousV2Result {
  const {
    btcBars,
    onchainBars,
    dxyBars,
    vixBars,
    fundingBars,
    params,
    initialCapital,
  } = input;

  if (btcBars.length === 0) return empty();

  // Onchain features
  const feats = computeOnchainFeatures(onchainBars, {
    nvtLookback: params.nvtLookback,
    aaLookback: params.aaLookback,
    percentileWindow: params.percentileWindow,
  });
  const featByTime = new Map<number, OnchainFeatureBar>();
  for (const f of feats) featByTime.set(f.date.getTime(), f);

  // Macro (forward-fill to BTC dates)
  const btcDates = btcBars.map((b) => b.date);
  const dxyAligned = forwardFillMacro(dxyBars, btcDates);
  const vixAligned = forwardFillMacro(vixBars, btcDates);
  const dxyValid = dxyAligned.map((v) => (v === null ? 0 : v));
  const dxySmaRaw = simpleMa(dxyValid, params.dxySmaPeriod);
  const dxySma = dxySmaRaw.map((v, i) => (dxyAligned[i] === null ? null : v));

  // Funding: compute rolling percentile on the funding series, then map to BTC dates
  const fundingByTime = new Map<number, number>();
  for (const f of fundingBars) fundingByTime.set(f.date.getTime(), f.avgRate);
  const fundingSeries: (number | null)[] = fundingBars.map((f) => f.avgRate);
  const fundingPcts = rollingPercentile(fundingSeries, params.fundingLookback);
  const fundingPctByTime = new Map<number, number>();
  for (let i = 0; i < fundingBars.length; i++) {
    const v = fundingPcts[i];
    if (v !== null) {
      fundingPctByTime.set(fundingBars[i].date.getTime(), v);
    }
  }

  let cash = initialCapital;
  let btcUnits = 0;
  let currentPosition = 0;
  const trades: ContinuousV2Trade[] = [];
  const equityCurve: EquityPoint[] = [];

  for (let i = 0; i < btcBars.length; i++) {
    const bar = btcBars[i];
    const feat = featByTime.get(bar.date.getTime());
    const fundingPct = fundingPctByTime.get(bar.date.getTime()) ?? null;

    const target = computeTargetPosition(
      feat,
      dxyAligned[i],
      dxySma[i],
      vixAligned[i],
      params.vixThreshold,
      fundingPct,
    );

    if (Math.abs(target - currentPosition) > params.rebalanceThreshold) {
      const equityNow = cash + btcUnits * bar.close;
      const targetBtcValue = equityNow * target;
      const currentBtcValue = btcUnits * bar.close;
      const delta = targetBtcValue - currentBtcValue;

      if (delta > 0) {
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
