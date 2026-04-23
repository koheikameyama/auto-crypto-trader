import type { DailyBar } from "../types/bar.js";
import type { AssetSymbol } from "../types/asset.js";
import type { Strategy } from "../types/strategy.js";
import { runBacktest } from "../backtest/engine.js";

export interface OptimizerArgs<P extends Record<string, number>> {
  strategy: Strategy<P>;
  bars: DailyBar[];
  asset: AssetSymbol;
  paramGrid: { [K in keyof P]: number[] };
  initialCapital: number;
  riskRatio: number;
  annualFundingRate?: number;
}

export interface OptimizerResult<P> {
  bestParams: P;
  bestSharpe: number;
  allResults: Array<{ params: P; sharpe: number; tradeCount: number }>;
}

const MIN_TRADE_COUNT = 5;

function cartesian<P extends Record<string, number>>(
  grid: { [K in keyof P]: number[] },
): P[] {
  const keys = Object.keys(grid) as (keyof P)[];
  let combos: Partial<P>[] = [{}];
  for (const k of keys) {
    const next: Partial<P>[] = [];
    for (const c of combos) {
      for (const v of grid[k]) {
        next.push({ ...c, [k]: v });
      }
    }
    combos = next;
  }
  return combos as P[];
}

function normalizeSharpe(s: number): number {
  if (Number.isNaN(s)) return Number.NEGATIVE_INFINITY;
  if (s === Infinity) return Number.MAX_SAFE_INTEGER;
  if (s === -Infinity) return Number.NEGATIVE_INFINITY;
  return s;
}

/**
 * Grid-search optimizer: evaluates every combination in `paramGrid` and picks
 * the highest-Sharpe combo that meets MIN_TRADE_COUNT. Falls back to all
 * combos if none qualify.
 */
export function optimizeStrategy<P extends Record<string, number>>(
  args: OptimizerArgs<P>,
): OptimizerResult<P> {
  const {
    strategy,
    bars,
    asset,
    paramGrid,
    initialCapital,
    riskRatio,
    annualFundingRate,
  } = args;

  const combos = cartesian(paramGrid);
  const allResults: Array<{ params: P; sharpe: number; tradeCount: number }> =
    [];

  for (const params of combos) {
    const r = runBacktest({
      bars,
      asset,
      strategy,
      params,
      initialCapital,
      riskRatio,
      annualFundingRate,
    });
    allResults.push({
      params,
      sharpe: r.sharpe,
      tradeCount: r.tradeCount,
    });
  }

  const qualified = allResults.filter((r) => r.tradeCount >= MIN_TRADE_COUNT);
  const pool = qualified.length > 0 ? qualified : allResults;

  let best = pool[0];
  for (const r of pool) {
    if (normalizeSharpe(r.sharpe) > normalizeSharpe(best.sharpe)) {
      best = r;
    }
  }

  return {
    bestParams: best.params,
    bestSharpe: best.sharpe,
    allResults,
  };
}
