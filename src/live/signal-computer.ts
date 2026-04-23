import { rollingPercentile } from "../lib/onchain-indicators.js";
import { forwardFillMacro } from "../data/macro-loader.js";
import type { DailyBar } from "../types/bar.js";
import type { FundingBar } from "../data/funding-loader.js";

/**
 * Live signal computation extracted from weighted-ensemble-engine.
 * Given latest DXY + funding histories, compute today's Scheme E target position.
 */
export interface LiveSignalInput {
  /** DXY daily bars, US-biz-day only, latest bar first-or-last does not matter */
  dxyBars: DailyBar[];
  /** Funding daily bars (BTCUSDT or ETHUSDT perp) */
  fundingBars: FundingBar[];
  /** Reference "today" — the latest trading date to evaluate signal for */
  today: Date;
  /** Weight scheme (Scheme E default: wDxy=0.60, wFunding=0.40) */
  wDxy?: number;
  wFunding?: number;
  /** DXY SMA period (default 200) */
  dxySmaPeriod?: number;
  /** Funding rolling percentile lookback (default 365) */
  fundingLookback?: number;
}

export interface LiveSignalOutput {
  date: Date;
  dxyValue: number | null;
  dxySma: number | null;
  dxyScore: number;
  fundingValue: number | null;
  fundingPercentile: number | null;
  fundingScore: number;
  targetPosition: number;
  wDxy: number;
  wFunding: number;
}

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

export function computeLiveSignal(input: LiveSignalInput): LiveSignalOutput {
  const {
    dxyBars,
    fundingBars,
    today,
    wDxy = 0.60,
    wFunding = 0.40,
    dxySmaPeriod = 200,
    fundingLookback = 365,
  } = input;

  // DXY: forward-fill to today (US biz day → crypto 24/7 date)
  const dxyAlignedToday = forwardFillMacro(dxyBars, [today]);
  const dxyToday = dxyAlignedToday[0];

  // DXY SMA on aligned series (treat nulls as 0 in MA calc, then re-mask)
  const dxyBiz = dxyBars.map((b) => b.close);
  const dxySmaRaw = simpleMa(dxyBiz, dxySmaPeriod);
  const dxySmaToday =
    dxyBars.length > 0 && dxySmaRaw.length > 0
      ? dxySmaRaw[dxySmaRaw.length - 1]
      : null;

  let dxyScore = 0.5;
  if (dxyToday !== null && dxySmaToday !== null && dxySmaToday > 0) {
    const ratio = dxyToday / dxySmaToday;
    if (ratio < 0.97) dxyScore = 1;
    else if (ratio > 1.03) dxyScore = 0;
    else dxyScore = (1.03 - ratio) / 0.06;
  }

  // Funding percentile on full funding history
  const fundingSeries: (number | null)[] = fundingBars.map((b) => b.avgRate);
  const fundingPcts = rollingPercentile(fundingSeries, fundingLookback);

  // Latest funding + its percentile
  let fundingValue: number | null = null;
  let fundingPct: number | null = null;
  for (let i = fundingBars.length - 1; i >= 0; i--) {
    if (fundingBars[i].date.getTime() <= today.getTime()) {
      fundingValue = fundingBars[i].avgRate;
      fundingPct = fundingPcts[i];
      break;
    }
  }

  let fundingScore = 0.5;
  if (fundingPct !== null) fundingScore = 1 - fundingPct;

  // Combined target (normalize weights on available subset)
  const scores: { w: number; s: number }[] = [];
  if (wDxy > 0) scores.push({ w: wDxy, s: dxyScore });
  if (wFunding > 0) scores.push({ w: wFunding, s: fundingScore });
  const wSum = scores.reduce((a, b) => a + b.w, 0);
  const targetPosition =
    wSum > 0 ? scores.reduce((a, b) => a + b.s * b.w, 0) / wSum : 0.5;

  return {
    date: today,
    dxyValue: dxyToday,
    dxySma: dxySmaToday,
    dxyScore,
    fundingValue,
    fundingPercentile: fundingPct,
    fundingScore,
    targetPosition,
    wDxy,
    wFunding,
  };
}
