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

export interface MultiSignalParams extends Record<string, number> {
  // Onchain
  nvtLookback: number;
  nvtPercentile: number;
  aaLookback: number;
  aaMomentumThreshold: number;
  percentileWindow: number;
  // Macro
  dxySmaPeriod: number;
  vixThreshold: number;
}

export const multiSignalDefaults: MultiSignalParams = {
  nvtLookback: 14,
  nvtPercentile: 0.7,
  aaLookback: 30,
  aaMomentumThreshold: 1.0,
  percentileWindow: 365,
  dxySmaPeriod: 200,
  vixThreshold: 30,
};

export type MsExitReason = "regime_bear" | "end_of_data";

export interface MsTrade {
  entryDate: Date;
  entryPrice: number;
  exitDate: Date;
  exitPrice: number;
  exitReason: MsExitReason;
  btcUnits: number;
  pnlUsd: number;
  holdingDays: number;
}

export interface MsResult {
  trades: MsTrade[];
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

export interface MsInput {
  btcBars: DailyBar[];
  onchainBars: OnchainBar[];
  dxyBars: DailyBar[]; // full history, US business days only
  vixBars: DailyBar[];
  params: MultiSignalParams;
  initialCapital: number;
  precomputedFeatures?: OnchainFeatureBar[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
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

function isOnchainBullish(
  feat: OnchainFeatureBar,
  p: MultiSignalParams,
): boolean {
  if (feat.nvtPercentile === null || feat.aaMomentum === null) return false;
  return (
    feat.nvtPercentile < p.nvtPercentile &&
    feat.aaMomentum > p.aaMomentumThreshold
  );
}

function empty(): MsResult {
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
 * Multi-signal regime-filtered BH backtest.
 *
 * Bullish regime iff ALL of:
 *   1. Onchain bullish (nvtPercentile < threshold AND aaMomentum > threshold)
 *   2. DXY below 200-day SMA (weakening USD = crypto-friendly)
 *   3. VIX below threshold (low fear, risk-on)
 *
 * Binary long/cash switching; fees at each transition.
 */
export function runMultiSignalBacktest(input: MsInput): MsResult {
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
  if (!precomputedFeatures && onchainBars.length === 0) return empty();

  // Onchain features
  const feats =
    precomputedFeatures ??
    computeOnchainFeatures(onchainBars, {
      nvtLookback: params.nvtLookback,
      aaLookback: params.aaLookback,
      percentileWindow: params.percentileWindow,
    });
  const featByTime = new Map<number, OnchainFeatureBar>();
  for (const f of feats) featByTime.set(f.date.getTime(), f);

  // Macro forward-fill aligned to BTC bar dates
  const btcDates = btcBars.map((b) => b.date);
  const dxyAligned = forwardFillMacro(dxyBars, btcDates);
  const vixAligned = forwardFillMacro(vixBars, btcDates);

  // DXY SMA from the aligned series (not on US-biz-day only series)
  const dxyValid = dxyAligned.map((v) => (v === null ? 0 : v));
  const dxySmaRaw = simpleMa(dxyValid, params.dxySmaPeriod);
  // If dxyAligned[i] is null, treat SMA as null too
  const dxySma = dxySmaRaw.map((v, i) => (dxyAligned[i] === null ? null : v));

  let cash = initialCapital;
  let holding: {
    entryDate: Date;
    entryPrice: number;
    btcUnits: number;
  } | null = null;

  const trades: MsTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  for (let i = 0; i < btcBars.length; i++) {
    const bar = btcBars[i];
    const feat = featByTime.get(bar.date.getTime());
    const dxy = dxyAligned[i];
    const dxyMa = dxySma[i];
    const vix = vixAligned[i];

    // All three must be evaluatable and bullish
    const onchainOk = feat ? isOnchainBullish(feat, params) : false;
    const dxyOk = dxy !== null && dxyMa !== null ? dxy < dxyMa : false;
    const vixOk = vix !== null ? vix < params.vixThreshold : false;
    const bullish = onchainOk && dxyOk && vixOk;

    // Exit
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

    // Entry
    if (holding === null && bullish) {
      const effEntry = applyFee("BTC-USD", "long", "entry", bar.close);
      holding = {
        entryDate: bar.date,
        entryPrice: effEntry,
        btcUnits: cash / effEntry,
      };
      cash = 0;
    }

    const equity = holding !== null ? holding.btcUnits * bar.close : cash;
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
      equityCurve[equityCurve.length - 1] = { date: last.date, equity: cash };
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
    equityCurve[equityCurve.length - 1]?.date ??
    btcBars[btcBars.length - 1].date;
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
