import type { DailyBar } from "../types/bar.js";
import type { AssetSymbol } from "../types/asset.js";
import type { Strategy } from "../types/strategy.js";
import type { BacktestTrade } from "../types/trade.js";
import { runBacktest, type BacktestResult, type EquityPoint } from "./engine.js";
import {
  sharpeRatio,
  maxDrawdown,
  profitFactor,
  expectancy,
  marRatio,
  annualReturn,
  winRate,
} from "../lib/metrics.js";

export interface CombinedAssetInput<P> {
  asset: AssetSymbol;
  bars: DailyBar[];
  strategy: Strategy<P>;
  params: P;
}

export interface CombinedRunInput {
  assets: CombinedAssetInput<Record<string, unknown>>[];
  initialCapital: number;
  riskRatio: number;
  annualFundingRate?: number;
  /** 各銘柄への資金配分比。省略時は等分。長さは assets と一致させる */
  weights?: number[];
}

export interface CombinedRunResult extends BacktestResult {
  perAsset: Array<{
    asset: AssetSymbol;
    weight: number;
    result: BacktestResult;
  }>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function equalWeights(n: number): number[] {
  return Array(n).fill(1 / n);
}

/**
 * Combined ポートフォリオランナー（MVP: 等分、独立運用）。
 *
 * 各銘柄に initialCapital × weight を割り当てて独立にバックテスト。
 * 日付単位で equity を合算して Combined curve を生成。
 * Combined KPI は合算 equity curve / 合算 trades から計算。
 *
 * 設計 §14 に従い分散ナイーブ実装（リスクパリティや相関調整なし）。
 */
export function runCombinedBacktest(input: CombinedRunInput): CombinedRunResult {
  const {
    assets,
    initialCapital,
    riskRatio,
    annualFundingRate,
    weights,
  } = input;

  if (assets.length === 0) {
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
      perAsset: [],
    };
  }

  const w = weights ?? equalWeights(assets.length);
  if (w.length !== assets.length) {
    throw new Error(
      `weights length ${w.length} does not match assets length ${assets.length}`,
    );
  }

  const perAsset: Array<{
    asset: AssetSymbol;
    weight: number;
    result: BacktestResult;
  }> = [];

  for (let i = 0; i < assets.length; i++) {
    const a = assets[i];
    const capital = initialCapital * w[i];
    const result = runBacktest({
      bars: a.bars,
      asset: a.asset,
      strategy: a.strategy,
      params: a.params,
      initialCapital: capital,
      riskRatio,
      annualFundingRate,
    });
    perAsset.push({ asset: a.asset, weight: w[i], result });
  }

  // Merge trades
  const trades: BacktestTrade[] = perAsset.flatMap((p) => p.result.trades);

  // Merge equity curves by date (sum equity across assets per date)
  const equityByDate = new Map<number, number>();
  for (const p of perAsset) {
    for (const pt of p.result.equityCurve) {
      const t = pt.date.getTime();
      equityByDate.set(t, (equityByDate.get(t) ?? 0) + pt.equity);
    }
  }
  const sortedDates = Array.from(equityByDate.keys()).sort((a, b) => a - b);
  const equityCurve: EquityPoint[] = sortedDates.map((t) => ({
    date: new Date(t),
    equity: equityByDate.get(t) ?? 0,
  }));

  const finalEquity =
    equityCurve.length > 0
      ? equityCurve[equityCurve.length - 1].equity
      : initialCapital;
  const totalReturn = (finalEquity - initialCapital) / initialCapital;

  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev !== 0) {
      returns.push((equityCurve[i].equity - prev) / prev);
    }
  }
  const sharpe = sharpeRatio(returns);
  const mdd = maxDrawdown(equityCurve.map((p) => p.equity));

  const firstDate = equityCurve[0]?.date;
  const lastDate = equityCurve[equityCurve.length - 1]?.date;
  const years =
    firstDate && lastDate
      ? (lastDate.getTime() - firstDate.getTime()) / (365.25 * DAY_MS)
      : 0;
  const annualized = annualReturn(totalReturn, years);
  const mar = marRatio(annualized, mdd);

  const pnls = trades.map((t) => t.pnlUsd);
  const pf = profitFactor(pnls);
  const wr = winRate(pnls);
  const exp = expectancy(pnls);

  return {
    trades,
    equityCurve,
    totalReturn,
    sharpe,
    mar,
    profitFactor: pf,
    maxDrawdown: mdd,
    winRate: wr,
    expectancy: exp,
    tradeCount: trades.length,
    perAsset,
  };
}
