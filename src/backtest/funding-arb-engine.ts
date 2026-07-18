/**
 * Funding Rate Arbitrage Backtest Engine
 */

export interface FundingRateData {
  timestamp: Date;
  rate: number; // e.g., 0.0001
}

export interface BacktestParams {
  entryThreshold: number; // e.g., 0.007 (0.7%)
  exitThreshold: number; // e.g., 0.002 (0.2%)
  avgDays: number; // Moving average period (e.g., 3 days = 9 periods)
  initialCapital: number; // JPY
  positionSize: number; // Position size as % of capital (e.g., 1.0 = 100%)
}

export interface Trade {
  entryDate: Date;
  entryRate: number;
  exitDate?: Date;
  exitRate?: number;
  fundingEarned: number; // JPY
  holdingPeriods: number; // Number of 8-hour periods
}

export interface BacktestResult {
  params: BacktestParams;
  trades: Trade[];
  totalReturn: number; // %
  sharpeRatio: number;
  calmarRatio: number;
  maxDrawdown: number; // %
  winRate: number; // %
  positionHoldPercent: number; // % of time in position
  annualizedReturn: number; // %
  totalTrades: number;
  avgHoldingDays: number;
}

export class FundingArbEngine {
  /**
   * Calculate moving average of funding rate
   */
  private calculateMovingAvg(
    rates: FundingRateData[],
    endIndex: number,
    periods: number
  ): number {
    const startIndex = Math.max(0, endIndex - periods + 1);
    const slice = rates.slice(startIndex, endIndex + 1);
    if (slice.length === 0) return 0;
    return slice.reduce((sum, r) => sum + r.rate, 0) / slice.length;
  }

  /**
   * Run backtest
   */
  runBacktest(
    fundingRates: FundingRateData[],
    params: BacktestParams
  ): BacktestResult {
    const { entryThreshold, exitThreshold, avgDays, initialCapital, positionSize } = params;
    const avgPeriods = avgDays * 3; // 3 periods per day (8 hours each)

    const trades: Trade[] = [];
    let currentTrade: Trade | null = null;
    let equity = initialCapital;
    const equityCurve: number[] = [initialCapital];
    let inPosition = false;
    let periodsInPosition = 0;

    for (let i = 0; i < fundingRates.length; i++) {
      const current = fundingRates[i];
      const movingAvg = this.calculateMovingAvg(fundingRates, i, avgPeriods);

      // Skip if not enough data for moving average
      if (i < avgPeriods - 1) {
        equityCurve.push(equity);
        continue;
      }

      // Entry signal
      if (!inPosition && movingAvg > entryThreshold) {
        inPosition = true;
        currentTrade = {
          entryDate: current.timestamp,
          entryRate: movingAvg,
          fundingEarned: 0,
          holdingPeriods: 0,
        };
      }

      // If in position, accumulate funding
      if (inPosition && currentTrade) {
        periodsInPosition++;
        currentTrade.holdingPeriods++;

        // Funding earned this period (per 8 hours)
        const fundingThisPeriod = current.rate * positionSize * equity;
        currentTrade.fundingEarned += fundingThisPeriod;
        equity += fundingThisPeriod;

        // Exit signal
        if (movingAvg < exitThreshold) {
          inPosition = false;
          currentTrade.exitDate = current.timestamp;
          currentTrade.exitRate = movingAvg;
          trades.push(currentTrade);
          currentTrade = null;
        }
      }

      equityCurve.push(equity);
    }

    // Close any open trade at the end
    if (currentTrade) {
      currentTrade.exitDate = fundingRates[fundingRates.length - 1].timestamp;
      currentTrade.exitRate = this.calculateMovingAvg(
        fundingRates,
        fundingRates.length - 1,
        avgPeriods
      );
      trades.push(currentTrade);
    }

    // Calculate metrics
    const totalReturn = ((equity - initialCapital) / initialCapital) * 100;
    const positionHoldPercent = (periodsInPosition / fundingRates.length) * 100;
    const winningTrades = trades.filter((t) => t.fundingEarned > 0).length;
    const winRate = trades.length > 0 ? (winningTrades / trades.length) * 100 : 0;

    // Annualized return (assuming ~333 days of data)
    const daysInBacktest = fundingRates.length / 3; // 3 periods per day
    const annualizedReturn = (totalReturn / daysInBacktest) * 365;

    // Sharpe ratio (simplified: return / volatility)
    const returns = equityCurve.slice(1).map((eq, i) => (eq - equityCurve[i]) / equityCurve[i]);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const volatility = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
    const sharpeRatio = volatility > 0 ? (avgReturn / volatility) * Math.sqrt(365 * 3) : 0;

    // Max drawdown
    let maxDrawdown = 0;
    let peak = equityCurve[0];
    for (const eq of equityCurve) {
      if (eq > peak) peak = eq;
      const drawdown = ((peak - eq) / peak) * 100;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    }

    // Calmar ratio
    const calmarRatio = maxDrawdown > 0 ? annualizedReturn / maxDrawdown : 0;

    // Average holding days
    const avgHoldingDays =
      trades.length > 0
        ? trades.reduce((sum, t) => sum + t.holdingPeriods, 0) / trades.length / 3
        : 0;

    return {
      params,
      trades,
      totalReturn,
      sharpeRatio,
      calmarRatio,
      maxDrawdown,
      winRate,
      positionHoldPercent,
      annualizedReturn,
      totalTrades: trades.length,
      avgHoldingDays,
    };
  }

  /**
   * Run grid search over multiple parameter combinations
   */
  gridSearch(
    fundingRates: FundingRateData[],
    entryThresholds: number[],
    exitThresholds: number[],
    avgDaysList: number[],
    initialCapital: number = 100000
  ): BacktestResult[] {
    const results: BacktestResult[] = [];

    for (const entryThreshold of entryThresholds) {
      for (const exitThreshold of exitThresholds) {
        for (const avgDays of avgDaysList) {
          const params: BacktestParams = {
            entryThreshold,
            exitThreshold,
            avgDays,
            initialCapital,
            positionSize: 1.0,
          };
          const result = this.runBacktest(fundingRates, params);
          results.push(result);
        }
      }
    }

    return results;
  }
}
