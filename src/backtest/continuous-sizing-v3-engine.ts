import type { DailyBar } from "../types/bar.js";
import type { OnchainBar } from "../data/onchain-loader.js";
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
 * v3: 4-signal continuous sizing (onchain + DXY + VIX + TNX yield).
 * Full 10y compatible (no funding rate dependency).
 */
export interface ContinuousV3Params extends Record<string, number> {
  nvtLookback: number;
  aaLookback: number;
  percentileWindow: number;
  dxySmaPeriod: number;
  vixThreshold: number;
  tnxLookback: number; // rolling percentile window for TNX
  rebalanceThreshold: number;
}

export const continuousV3Defaults: ContinuousV3Params = {
  nvtLookback: 14,
  aaLookback: 30,
  percentileWindow: 365,
  dxySmaPeriod: 200,
  vixThreshold: 30,
  tnxLookback: 365,
  rebalanceThreshold: 0.1,
};

export interface ContinuousV3Trade {
  date: Date;
  price: number;
  prevPosition: number;
  newPosition: number;
  btcUnitsDelta: number;
}

export interface ContinuousV3Result {
  trades: ContinuousV3Trade[];
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

export interface ContinuousV3Input {
  btcBars: DailyBar[];
  onchainBars: OnchainBar[];
  dxyBars: DailyBar[];
  vixBars: DailyBar[];
  tnxBars: DailyBar[];
  params: ContinuousV3Params;
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
  tnxPct: number | null,
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

  // TNX: low percentile = low yields = easing = bullish for crypto
  let tnxScore = 0.5;
  if (tnxPct !== null) {
    tnxScore = 1 - tnxPct;
  }

  return (onchainScore + dxyScore + vixScore + tnxScore) / 4;
}

function empty(): ContinuousV3Result {
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

export function runContinuousV3Backtest(
  input: ContinuousV3Input,
): ContinuousV3Result {
  const {
    btcBars,
    onchainBars,
    dxyBars,
    vixBars,
    tnxBars,
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

  // Macro forward-fill
  const btcDates = btcBars.map((b) => b.date);
  const dxyAligned = forwardFillMacro(dxyBars, btcDates);
  const vixAligned = forwardFillMacro(vixBars, btcDates);
  const tnxAligned = forwardFillMacro(tnxBars, btcDates);

  const dxyValid = dxyAligned.map((v) => (v === null ? 0 : v));
  const dxySmaRaw = simpleMa(dxyValid, params.dxySmaPeriod);
  const dxySma = dxySmaRaw.map((v, i) => (dxyAligned[i] === null ? null : v));

  // TNX rolling percentile on US biz day series
  const tnxSeries: (number | null)[] = tnxBars.map((b) => b.close);
  const tnxPcts = rollingPercentile(tnxSeries, params.tnxLookback);
  const tnxPctByTime = new Map<number, number>();
  for (let i = 0; i < tnxBars.length; i++) {
    const v = tnxPcts[i];
    if (v !== null) tnxPctByTime.set(tnxBars[i].date.getTime(), v);
  }
  // Forward-fill TNX percentile to BTC dates
  const sortedTnxTimes = [...tnxPctByTime.keys()].sort((a, b) => a - b);
  const tnxPctAligned: (number | null)[] = btcDates.map((d) => {
    const t = d.getTime();
    // Find latest tnxPct time <= t
    let lo = 0, hi = sortedTnxTimes.length - 1, res = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sortedTnxTimes[mid] <= t) {
        res = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return res === -1 ? null : tnxPctByTime.get(sortedTnxTimes[res]) ?? null;
  });

  let cash = initialCapital;
  let btcUnits = 0;
  let currentPosition = 0;
  const trades: ContinuousV3Trade[] = [];
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
