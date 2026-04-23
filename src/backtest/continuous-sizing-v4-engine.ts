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
 * v4: 5-signal continuous sizing.
 * Signals: onchain + DXY + VIX + funding + TNX yield.
 * Requires funding data (Binance BTCUSDT perp, 2019-10+).
 */
export interface ContinuousV4Params extends Record<string, number> {
  nvtLookback: number;
  aaLookback: number;
  percentileWindow: number;
  dxySmaPeriod: number;
  vixThreshold: number;
  fundingLookback: number;
  tnxLookback: number;
  rebalanceThreshold: number;
}

export const continuousV4Defaults: ContinuousV4Params = {
  nvtLookback: 14,
  aaLookback: 30,
  percentileWindow: 365,
  dxySmaPeriod: 200,
  vixThreshold: 30,
  fundingLookback: 365,
  tnxLookback: 365,
  rebalanceThreshold: 0.1,
};

export interface ContinuousV4Trade {
  date: Date;
  price: number;
  prevPosition: number;
  newPosition: number;
  btcUnitsDelta: number;
}

export interface ContinuousV4Result {
  trades: ContinuousV4Trade[];
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

export interface ContinuousV4Input {
  btcBars: DailyBar[];
  onchainBars: OnchainBar[];
  dxyBars: DailyBar[];
  vixBars: DailyBar[];
  fundingBars: FundingBar[];
  tnxBars: DailyBar[];
  params: ContinuousV4Params;
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

function computeTargetPosition(
  feat: OnchainFeatureBar | undefined,
  dxy: number | null,
  dxyMa: number | null,
  vix: number | null,
  vixThreshold: number,
  fundingPct: number | null,
  tnxPct: number | null,
): number {
  let onchainScore = 0;
  if (feat && feat.nvtPercentile !== null && feat.aaMomentum !== null) {
    const nvtScore = 1 - feat.nvtPercentile;
    const aaScore = Math.max(0, Math.min(1, (feat.aaMomentum - 0.8) / 0.4));
    onchainScore = (nvtScore + aaScore) / 2;
  }

  let dxyScore = 0.5;
  if (dxy !== null && dxyMa !== null && dxyMa > 0) {
    const ratio = dxy / dxyMa;
    if (ratio < 0.97) dxyScore = 1;
    else if (ratio > 1.03) dxyScore = 0;
    else dxyScore = (1.03 - ratio) / 0.06;
  }

  let vixScore = 0.5;
  if (vix !== null) {
    if (vix < vixThreshold * 0.7) vixScore = 1;
    else if (vix > vixThreshold * 1.3) vixScore = 0;
    else vixScore = 1 - (vix - vixThreshold * 0.7) / (vixThreshold * 0.6);
  }

  let fundingScore = 0.5;
  if (fundingPct !== null) fundingScore = 1 - fundingPct;

  let tnxScore = 0.5;
  if (tnxPct !== null) tnxScore = 1 - tnxPct;

  return (onchainScore + dxyScore + vixScore + fundingScore + tnxScore) / 5;
}

function empty(): ContinuousV4Result {
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
    let lo = 0,
      hi = sortedTimes.length - 1,
      res = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sortedTimes[mid] <= t) {
        res = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return res === -1 ? null : pctByTime.get(sortedTimes[res]) ?? null;
  });
}

export function runContinuousV4Backtest(
  input: ContinuousV4Input,
): ContinuousV4Result {
  const {
    btcBars,
    onchainBars,
    dxyBars,
    vixBars,
    fundingBars,
    tnxBars,
    params,
    initialCapital,
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

  // Funding percentile
  const fundingSeries: (number | null)[] = fundingBars.map((f) => f.avgRate);
  const fundingPcts = rollingPercentile(fundingSeries, params.fundingLookback);
  const fundingPctByTime = new Map<number, number>();
  for (let i = 0; i < fundingBars.length; i++) {
    const v = fundingPcts[i];
    if (v !== null) fundingPctByTime.set(fundingBars[i].date.getTime(), v);
  }
  const fundingDates = fundingBars.map((f) => f.date);
  const fundingPctAligned = percentileAligned(fundingDates, fundingPctByTime, btcDates);

  // TNX percentile
  const tnxSeries: (number | null)[] = tnxBars.map((b) => b.close);
  const tnxPcts = rollingPercentile(tnxSeries, params.tnxLookback);
  const tnxPctByTime = new Map<number, number>();
  for (let i = 0; i < tnxBars.length; i++) {
    const v = tnxPcts[i];
    if (v !== null) tnxPctByTime.set(tnxBars[i].date.getTime(), v);
  }
  const tnxDates = tnxBars.map((b) => b.date);
  const tnxPctAligned = percentileAligned(tnxDates, tnxPctByTime, btcDates);

  let cash = initialCapital;
  let btcUnits = 0;
  let currentPosition = 0;
  const trades: ContinuousV4Trade[] = [];
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
      fundingPctAligned[i],
      tnxPctAligned[i],
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
          date: bar.date,
          price: effPrice,
          prevPosition: currentPosition,
          newPosition: target,
          btcUnitsDelta: unitsToBuy,
        });
      } else {
        const effPrice = applyFee("BTC-USD", "long", "exit", bar.close);
        const unitsToSell = -delta / bar.close;
        const actualUnitsToSell = Math.min(btcUnits, unitsToSell);
        btcUnits -= actualUnitsToSell;
        cash += actualUnitsToSell * effPrice;
        trades.push({
          date: bar.date,
          price: effPrice,
          prevPosition: currentPosition,
          newPosition: target,
          btcUnitsDelta: -actualUnitsToSell,
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
