/**
 * BTC-ETH Pair Trading Backtest Engine
 *
 * Strategy: Long/short based on z-score of BTC/ETH ratio
 * - Entry: |z-score| > threshold (e.g., 1.5)
 * - Exit: z-score crosses 0 or opposite threshold
 * - Dollar-neutral: Equal $ amounts long and short
 */

export interface PriceData {
  date: Date;
  btcPrice: number;
  ethPrice: number;
}

export interface BacktestParams {
  entryThreshold: number; // e.g., 1.5 (enter when |z| > 1.5)
  exitThreshold: number; // e.g., 0.0 (exit when z crosses 0)
  lookbackDays: number; // rolling window for mean/std calculation
  initialCapital: number; // USD
  tradingFee: number; // e.g., 0.0002 (0.02%)
}

export interface Trade {
  entryDate: Date;
  exitDate?: Date;
  side: 'long-btc' | 'long-eth'; // long BTC/short ETH or vice versa
  entryZScore: number;
  exitZScore?: number;
  returnPct: number;
  holdingDays: number;
}

export interface BacktestResult {
  params: BacktestParams;
  trades: Trade[];
  totalReturn: number; // %
  sharpeRatio: number;
  calmarRatio: number;
  maxDrawdown: number; // %
  winRate: number; // %
  avgHoldingDays: number;
  totalTrades: number;
  annualizedReturn: number; // %
}

export class PairTradingEngine {
  /**
   * Calculate rolling mean and std of ratio
   */
  private calculateRollingStats(
    ratios: number[],
    index: number,
    lookbackDays: number
  ): { mean: number; std: number } {
    const start = Math.max(0, index - lookbackDays + 1);
    const window = ratios.slice(start, index + 1);

    if (window.length < lookbackDays / 2) {
      // Not enough data
      return { mean: 0, std: 0 };
    }

    const mean = window.reduce((sum, v) => sum + v, 0) / window.length;
    const variance = window.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / window.length;
    const std = Math.sqrt(variance);

    return { mean, std };
  }

  /**
   * Run backtest
   */
  runBacktest(priceData: PriceData[], params: BacktestParams): BacktestResult {
    const { entryThreshold, exitThreshold, lookbackDays, initialCapital, tradingFee } = params;

    // Calculate ratios
    const ratios = priceData.map(p => p.btcPrice / p.ethPrice);

    const trades: Trade[] = [];
    let equity = initialCapital;
    let baseCapital = initialCapital; // Track base capital for each trade
    const equityCurve: number[] = [initialCapital];
    let currentTrade: Partial<Trade> | null = null;
    let inPosition = false;

    for (let i = 0; i < priceData.length; i++) {
      const current = priceData[i];
      const ratio = ratios[i];

      // Calculate rolling z-score
      const stats = this.calculateRollingStats(ratios, i, lookbackDays);
      if (stats.std === 0) {
        equityCurve.push(equity);
        continue;
      }

      const zScore = (ratio - stats.mean) / stats.std;

      // Entry signals
      if (!inPosition) {
        if (zScore > entryThreshold) {
          // Ratio too high → short BTC, long ETH (expect ratio to decrease)
          inPosition = true;
          currentTrade = {
            entryDate: current.date,
            side: 'long-eth',
            entryZScore: zScore,
            holdingDays: 0,
            returnPct: 0,
          };
        } else if (zScore < -entryThreshold) {
          // Ratio too low → long BTC, short ETH (expect ratio to increase)
          inPosition = true;
          currentTrade = {
            entryDate: current.date,
            side: 'long-btc',
            entryZScore: zScore,
            holdingDays: 0,
            returnPct: 0,
          };
        }
      }

      // Update position P&L
      if (inPosition && currentTrade && i > 0) {
        const prevPrice = priceData[i - 1];
        const btcReturn = (current.btcPrice - prevPrice.btcPrice) / prevPrice.btcPrice;
        const ethReturn = (current.ethPrice - prevPrice.ethPrice) / prevPrice.ethPrice;

        // Calculate pair return (dollar-neutral)
        let pairReturn = 0;
        if (currentTrade.side === 'long-btc') {
          // Long BTC, Short ETH
          pairReturn = 0.5 * btcReturn - 0.5 * ethReturn;
        } else {
          // Long ETH, Short BTC
          pairReturn = 0.5 * ethReturn - 0.5 * btcReturn;
        }

        equity += equity * pairReturn;
        currentTrade.holdingDays!++;

        // Exit signals
        const shouldExit =
          (currentTrade.side === 'long-btc' && zScore < exitThreshold) ||
          (currentTrade.side === 'long-eth' && zScore > -exitThreshold) ||
          (currentTrade.side === 'long-btc' && zScore < -entryThreshold) ||
          (currentTrade.side === 'long-eth' && zScore > entryThreshold);

        if (shouldExit) {
          // Apply exit fees (both sides: close BTC and ETH positions)
          const exitFee = equity * tradingFee * 2; // 2 legs
          equity -= exitFee;

          currentTrade.exitDate = current.date;
          currentTrade.exitZScore = zScore;
          currentTrade.returnPct = ((equity - baseCapital) / baseCapital) * 100;

          trades.push(currentTrade as Trade);
          inPosition = false;
          currentTrade = null;

          // Reset capital for next trade
          baseCapital = equity;
        }
      }

      equityCurve.push(equity);
    }

    // Close any open trade at the end
    if (currentTrade) {
      const exitFee = equity * tradingFee * 2;
      equity -= exitFee;

      currentTrade.exitDate = priceData[priceData.length - 1].date;
      currentTrade.exitZScore = 0;
      currentTrade.returnPct = ((equity - baseCapital) / baseCapital) * 100;

      trades.push(currentTrade as Trade);
    }

    // Calculate metrics
    const totalReturn = ((equity - params.initialCapital) / params.initialCapital) * 100;
    const daysInBacktest = priceData.length;
    const annualizedReturn = (totalReturn / daysInBacktest) * 365;

    const winningTrades = trades.filter(t => t.returnPct > 0).length;
    const winRate = trades.length > 0 ? (winningTrades / trades.length) * 100 : 0;

    // Sharpe ratio
    const returns = equityCurve.slice(1).map((eq, i) => (eq - equityCurve[i]) / equityCurve[i]);
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    const volatility = Math.sqrt(
      returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length
    );
    const sharpeRatio = volatility > 0 ? (avgReturn / volatility) * Math.sqrt(365) : 0;

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
      trades.length > 0 ? trades.reduce((sum, t) => sum + t.holdingDays, 0) / trades.length : 0;

    return {
      params,
      trades,
      totalReturn,
      sharpeRatio,
      calmarRatio,
      maxDrawdown,
      winRate,
      avgHoldingDays,
      totalTrades: trades.length,
      annualizedReturn,
    };
  }

  /**
   * Grid search over parameters
   */
  gridSearch(
    priceData: PriceData[],
    entryThresholds: number[],
    exitThresholds: number[],
    lookbackDays: number[],
    initialCapital: number = 10000,
    tradingFee: number = 0.0002
  ): BacktestResult[] {
    const results: BacktestResult[] = [];

    for (const entry of entryThresholds) {
      for (const exit of exitThresholds) {
        for (const lookback of lookbackDays) {
          const params: BacktestParams = {
            entryThreshold: entry,
            exitThreshold: exit,
            lookbackDays: lookback,
            initialCapital,
            tradingFee,
          };

          const result = this.runBacktest(priceData, params);
          results.push(result);
        }
      }
    }

    return results;
  }
}
