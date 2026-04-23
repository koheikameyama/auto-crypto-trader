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

/**
 * Weighted ensemble engine — 5 signals with configurable weights.
 * Setting a weight to 0 effectively drops that signal.
 * Weights should ideally sum to 1.0, but engine normalizes them.
 */
export interface WeightedParams extends Record<string, number> {
  // Onchain
  nvtLookback: number;
  aaLookback: number;
  percentileWindow: number;
  // Macro
  dxySmaPeriod: number;
  vixThreshold: number;
  fundingLookback: number;
  tnxLookback: number;
  // Rebalance
  rebalanceThreshold: number;
  // Weights (0..1 each)
  wOnchain: number;
  wDxy: number;
  wVix: number;
  wFunding: number;
  wTnx: number;
}

export interface WeightedTrade {
  date: Date;
  price: number;
  prevPosition: number;
  newPosition: number;
  btcUnitsDelta: number;
}

export interface WeightedResult {
  trades: WeightedTrade[];
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

export interface WeightedInput {
  btcBars: DailyBar[];
  onchainBars: OnchainBar[];
  dxyBars: DailyBar[];
  vixBars: DailyBar[];
  fundingBars: FundingBar[];
  tnxBars: DailyBar[];
  params: WeightedParams;
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

function percentileAligned(
  seriesDates: Date[],
  pctByTime: Map<number, number>,
  targetDates: Date[],
): (number | null)[] {
  const sortedTimes = seriesDates
    .filter((d) => pctByTime.has(d.getTime()))
    .map((d) => d.getTime())
    .sort((a, b) => a - b);
  return targetDates.map((d) => {
    const t = d.getTime();
    let lo = 0, hi = sortedTimes.length - 1, res = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sortedTimes[mid] <= t) { res = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return res === -1 ? null : pctByTime.get(sortedTimes[res]) ?? null;
  });
}

/**
 * Compute target position as weighted average of signal scores.
 * Uses only signals with weight > 0 AND non-null score. Weights renormalized
 * on the available subset (so dropping one signal's data doesn't bias).
 */
function computeWeightedTarget(
  feat: OnchainFeatureBar | undefined,
  dxy: number | null,
  dxyMa: number | null,
  vix: number | null,
  vixThreshold: number,
  fundingPct: number | null,
  tnxPct: number | null,
  params: WeightedParams,
): number {
  const scores: { w: number; s: number }[] = [];

  if (params.wOnchain > 0 && feat && feat.nvtPercentile !== null && feat.aaMomentum !== null) {
    const nvtScore = 1 - feat.nvtPercentile;
    const aaScore = Math.max(0, Math.min(1, (feat.aaMomentum - 0.8) / 0.4));
    scores.push({ w: params.wOnchain, s: (nvtScore + aaScore) / 2 });
  }

  if (params.wDxy > 0 && dxy !== null && dxyMa !== null && dxyMa > 0) {
    const ratio = dxy / dxyMa;
    let dxyScore = 0.5;
    if (ratio < 0.97) dxyScore = 1;
    else if (ratio > 1.03) dxyScore = 0;
    else dxyScore = (1.03 - ratio) / 0.06;
    scores.push({ w: params.wDxy, s: dxyScore });
  }

  if (params.wVix > 0 && vix !== null) {
    let vixScore = 0.5;
    if (vix < vixThreshold * 0.7) vixScore = 1;
    else if (vix > vixThreshold * 1.3) vixScore = 0;
    else vixScore = 1 - (vix - vixThreshold * 0.7) / (vixThreshold * 0.6);
    scores.push({ w: params.wVix, s: vixScore });
  }

  if (params.wFunding > 0 && fundingPct !== null) {
    scores.push({ w: params.wFunding, s: 1 - fundingPct });
  }

  if (params.wTnx > 0 && tnxPct !== null) {
    scores.push({ w: params.wTnx, s: 1 - tnxPct });
  }

  if (scores.length === 0) return 0.5;
  const wSum = scores.reduce((a, b) => a + b.w, 0);
  if (wSum <= 0) return 0.5;
  return scores.reduce((a, b) => a + b.s * b.w, 0) / wSum;
}

function empty(): WeightedResult {
  return {
    trades: [], equityCurve: [],
    totalReturn: 0, sharpe: 0, mar: 0,
    profitFactor: 0, maxDrawdown: 0,
    winRate: 0, expectancy: 0, tradeCount: 0,
  };
}

export function runWeightedBacktest(input: WeightedInput): WeightedResult {
  const {
    btcBars, onchainBars, dxyBars, vixBars, fundingBars, tnxBars,
    params, initialCapital,
  } = input;

  if (btcBars.length === 0) return empty();

  const feats = computeOnchainFeatures(onchainBars, {
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

  const fundingSeries: (number | null)[] = fundingBars.map((f) => f.avgRate);
  const fundingPcts = rollingPercentile(fundingSeries, params.fundingLookback);
  const fundingPctByTime = new Map<number, number>();
  for (let i = 0; i < fundingBars.length; i++) {
    const v = fundingPcts[i];
    if (v !== null) fundingPctByTime.set(fundingBars[i].date.getTime(), v);
  }
  const fundingPctAligned = percentileAligned(
    fundingBars.map((f) => f.date), fundingPctByTime, btcDates,
  );

  const tnxSeries: (number | null)[] = tnxBars.map((b) => b.close);
  const tnxPcts = rollingPercentile(tnxSeries, params.tnxLookback);
  const tnxPctByTime = new Map<number, number>();
  for (let i = 0; i < tnxBars.length; i++) {
    const v = tnxPcts[i];
    if (v !== null) tnxPctByTime.set(tnxBars[i].date.getTime(), v);
  }
  const tnxPctAligned = percentileAligned(
    tnxBars.map((b) => b.date), tnxPctByTime, btcDates,
  );

  let cash = initialCapital;
  let btcUnits = 0;
  let currentPosition = 0;
  const trades: WeightedTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  for (let i = 0; i < btcBars.length; i++) {
    const bar = btcBars[i];
    const feat = featByTime.get(bar.date.getTime());
    const target = computeWeightedTarget(
      feat, dxyAligned[i], dxySma[i], vixAligned[i],
      params.vixThreshold, fundingPctAligned[i], tnxPctAligned[i],
      params,
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
        cash -= unitsToBuy * effPrice;
        trades.push({
          date: bar.date, price: effPrice,
          prevPosition: currentPosition, newPosition: target,
          btcUnitsDelta: unitsToBuy,
        });
      } else {
        const effPrice = applyFee("BTC-USD", "long", "exit", bar.close);
        const unitsToSell = -delta / bar.close;
        const actualUnitsToSell = Math.min(btcUnits, unitsToSell);
        btcUnits -= actualUnitsToSell;
        cash += actualUnitsToSell * effPrice;
        trades.push({
          date: bar.date, price: effPrice,
          prevPosition: currentPosition, newPosition: target,
          btcUnitsDelta: -actualUnitsToSell,
        });
      }
      currentPosition = target;
    }

    const equity = cash + btcUnits * bar.close;
    equityCurve.push({ date: bar.date, equity });
  }

  const finalEquity =
    equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].equity : initialCapital;
  const totalReturn = (finalEquity - initialCapital) / initialCapital;
  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev !== 0) returns.push((equityCurve[i].equity - prev) / prev);
  }
  const sharpe = sharpeRatio(returns);
  const mdd = maxDrawdown(equityCurve.map((p) => p.equity));
  const first = equityCurve[0]?.date ?? btcBars[0].date;
  const lastDate = equityCurve[equityCurve.length - 1]?.date ?? btcBars[btcBars.length - 1].date;
  const years = (lastDate.getTime() - first.getTime()) / (365.25 * DAY_MS);
  const mar = marRatio(annualReturn(totalReturn, years), mdd);
  const dailyPnls = returns.map((r, idx) => r * equityCurve[idx].equity);

  return {
    trades, equityCurve, totalReturn,
    sharpe, mar,
    profitFactor: profitFactor(dailyPnls),
    maxDrawdown: mdd,
    winRate: winRate(dailyPnls),
    expectancy: expectancy(dailyPnls),
    tradeCount: trades.length,
  };
}
