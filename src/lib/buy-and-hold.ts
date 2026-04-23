import type { DailyBar } from "../types/bar.js";
import {
  sharpeRatio,
  maxDrawdown,
  marRatio,
  annualReturn,
} from "./metrics.js";

export interface BuyAndHoldResult {
  startDate: Date;
  endDate: Date;
  startPrice: number;
  endPrice: number;
  totalReturn: number;
  annualReturn: number;
  sharpe: number;
  mar: number;
  maxDrawdown: number;
  /** Daily close-to-close simple returns series. */
  returns: number[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Buy & Hold ベンチマーク計算。
 *
 * 指定期間の最初の close で全力ロング → 最後の close までホールド。
 * 手数料・資金調達率は無視（純粋な市場リターン基準）。
 * Sharpe は close-to-close の日次リターンから metrics.sharpeRatio
 * （デフォルト annualization=365）で計算。
 *
 * 設計 §2 追加KPI「戦略 Sharpe > Buy & Hold Sharpe」の基準値として使う。
 */
export function buyAndHold(bars: DailyBar[]): BuyAndHoldResult | null {
  if (bars.length < 2) return null;

  const startBar = bars[0];
  const endBar = bars[bars.length - 1];
  if (startBar.close <= 0 || endBar.close <= 0) return null;

  const totalReturn = (endBar.close - startBar.close) / startBar.close;

  const returns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].close;
    if (prev > 0) {
      returns.push((bars[i].close - prev) / prev);
    }
  }

  const sharpe = sharpeRatio(returns);

  const equityCurve = bars.map((b) => b.close);
  const mdd = maxDrawdown(equityCurve);

  const years =
    (endBar.date.getTime() - startBar.date.getTime()) / (365.25 * DAY_MS);
  const ann = annualReturn(totalReturn, years);
  const mar = marRatio(ann, mdd);

  return {
    startDate: startBar.date,
    endDate: endBar.date,
    startPrice: startBar.close,
    endPrice: endBar.close,
    totalReturn,
    annualReturn: ann,
    sharpe,
    mar,
    maxDrawdown: mdd,
    returns,
  };
}
