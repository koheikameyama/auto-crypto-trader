import type { DailyBar } from "../types/bar.js";
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

export interface TrailingStopBhParams extends Record<string, number> {
  /** ATH からこの % 下落で cash に退避（例: 30 = -30%） */
  trailDrawdown: number;
  /** 退避後、底値から +re_entry_gain% 戻ったら再参入（例: 20 = +20%） */
  reentryGain: number;
}

export const trailingStopBhDefaults: TrailingStopBhParams = {
  trailDrawdown: 30,
  reentryGain: 20,
};

export type TrailingStopExitReason = "trail_stop" | "end_of_data";

export interface TrailingStopTrade {
  entryDate: Date;
  entryPrice: number;
  exitDate: Date;
  exitPrice: number;
  exitReason: TrailingStopExitReason;
  btcUnits: number;
  pnlUsd: number;
  holdingDays: number;
  athAtEntry: number;
}

export interface TrailingStopBacktestResult {
  trades: TrailingStopTrade[];
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

export interface TrailingStopBacktestInput {
  btcBars: DailyBar[];
  params: TrailingStopBhParams;
  initialCapital: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

function empty(): TrailingStopBacktestResult {
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
 * Trailing Stop Buy & Hold backtest.
 *
 * 状態遷移:
 * - LONG 時:
 *   - 価格更新ごとに ATH を記録
 *   - close が ATH × (1 - trailDrawdown/100) 以下なら cash に退避
 * - CASH 時:
 *   - cash 期間中の底値を記録
 *   - close が 底値 × (1 + reentryGain/100) 以上なら再参入
 *
 * 初期状態: LONG（全額 BTC 購入）
 */
export function runTrailingStopBh(
  input: TrailingStopBacktestInput,
): TrailingStopBacktestResult {
  const { btcBars, params, initialCapital } = input;
  if (btcBars.length === 0) return empty();

  const trailDd = params.trailDrawdown / 100;
  const reentryGain = params.reentryGain / 100;

  let cash = 0;
  let holding: {
    entryDate: Date;
    entryPrice: number; // effective (post-fee)
    btcUnits: number;
    athAtEntry: number;
  } | null = null;
  let ath = 0;
  let cashTroughSinceExit = Infinity;

  const trades: TrailingStopTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  // Initial entry: LONG at first bar close
  const firstBar = btcBars[0];
  const effEntry0 = applyFee("BTC-USD", "long", "entry", firstBar.close);
  holding = {
    entryDate: firstBar.date,
    entryPrice: effEntry0,
    btcUnits: initialCapital / effEntry0,
    athAtEntry: firstBar.close,
  };
  ath = firstBar.close;
  equityCurve.push({ date: firstBar.date, equity: initialCapital });

  for (let i = 1; i < btcBars.length; i++) {
    const bar = btcBars[i];

    if (holding !== null) {
      if (bar.close > ath) ath = bar.close;
      const stopPrice = ath * (1 - trailDd);

      if (bar.close <= stopPrice) {
        const daysHeld = daysBetween(holding.entryDate, bar.date);
        const effExit = applyFee("BTC-USD", "long", "exit", bar.close);
        const pnl = (effExit - holding.entryPrice) * holding.btcUnits;
        trades.push({
          entryDate: holding.entryDate,
          entryPrice: holding.entryPrice,
          exitDate: bar.date,
          exitPrice: effExit,
          exitReason: "trail_stop",
          btcUnits: holding.btcUnits,
          pnlUsd: pnl,
          holdingDays: daysHeld,
          athAtEntry: holding.athAtEntry,
        });
        cash = holding.btcUnits * effExit;
        holding = null;
        cashTroughSinceExit = bar.close;
      }
    } else {
      if (bar.close < cashTroughSinceExit) cashTroughSinceExit = bar.close;
      const reentryPrice = cashTroughSinceExit * (1 + reentryGain);
      if (bar.close >= reentryPrice) {
        const effEntry = applyFee("BTC-USD", "long", "entry", bar.close);
        holding = {
          entryDate: bar.date,
          entryPrice: effEntry,
          btcUnits: cash / effEntry,
          athAtEntry: bar.close,
        };
        ath = bar.close;
        cash = 0;
        cashTroughSinceExit = Infinity;
      }
    }

    // Mark-to-market
    const equity =
      holding !== null ? holding.btcUnits * bar.close : cash;
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
      athAtEntry: holding.athAtEntry,
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
