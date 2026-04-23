import { applyFee } from "../backtest/cost-model.js";
import type { AssetSymbol } from "../types/asset.js";

export interface SimulatorInput {
  asset: AssetSymbol;
  /** Today's asset close price */
  price: number;
  /** Scheme target position 0..1 */
  targetPosition: number;
  /** Previous state. null = first run (start all cash). */
  prev: {
    cashUsd: number;
    units: number;
  } | null;
  /** Used if prev is null */
  initialCapital: number;
  /** Rebalance only if |target - current| > this threshold */
  rebalanceThreshold: number;
}

export interface SimulatorOutput {
  cashUsd: number;
  units: number;
  equityUsd: number;
  /** Actual position after simulator decided to rebalance or not */
  actualPosition: number;
  rebalancedToday: boolean;
  /** Units added (buy) or removed (sell, negative) */
  rebalanceDelta: number;
  /** Fee paid this day in USD */
  feeUsd: number;
}

/**
 * Daily rebalance simulator — mirrors continuous-sizing-engine logic for a
 * single day. Returns new portfolio state after applying signal-driven
 * rebalance with fees.
 */
export function simulateDailyRebalance(input: SimulatorInput): SimulatorOutput {
  const { asset, price, targetPosition, prev, initialCapital, rebalanceThreshold } = input;

  let cashUsd: number;
  let units: number;
  if (prev === null) {
    // First run: all cash
    cashUsd = initialCapital;
    units = 0;
  } else {
    cashUsd = prev.cashUsd;
    units = prev.units;
  }

  const equityBefore = cashUsd + units * price;
  const currentPosition = equityBefore > 0 ? (units * price) / equityBefore : 0;

  const delta = targetPosition - currentPosition;
  let rebalancedToday = false;
  let rebalanceDelta = 0;
  let feeUsd = 0;

  if (Math.abs(delta) > rebalanceThreshold) {
    const targetValue = equityBefore * targetPosition;
    const currentValue = units * price;
    const deltaUsd = targetValue - currentValue;

    if (deltaUsd > 0) {
      // Buy more
      const effPrice = applyFee(asset, "long", "entry", price);
      const unitsToBuy = deltaUsd / effPrice;
      const cashSpent = unitsToBuy * effPrice;
      units += unitsToBuy;
      cashUsd -= cashSpent;
      rebalanceDelta = unitsToBuy;
      feeUsd = cashSpent - unitsToBuy * price;
    } else {
      // Sell
      const effPrice = applyFee(asset, "long", "exit", price);
      const unitsToSell = Math.min(-deltaUsd / price, units);
      const cashReceived = unitsToSell * effPrice;
      units -= unitsToSell;
      cashUsd += cashReceived;
      rebalanceDelta = -unitsToSell;
      feeUsd = unitsToSell * price - cashReceived;
    }
    rebalancedToday = true;
  }

  const equityUsd = cashUsd + units * price;
  const actualPosition = equityUsd > 0 ? (units * price) / equityUsd : 0;

  return {
    cashUsd,
    units,
    equityUsd,
    actualPosition,
    rebalancedToday,
    rebalanceDelta,
    feeUsd,
  };
}
