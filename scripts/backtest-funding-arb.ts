/**
 * Backtest Funding Rate Arbitrage Strategy
 */

import { PrismaClient } from '@prisma/client';
import { FundingArbEngine, BacktestResult } from '../src/backtest/funding-arb-engine.js';

const prisma = new PrismaClient();

async function main() {
  console.log('Running Funding Rate Arbitrage Backtest...\n');

  // Load funding rate data
  console.log('Loading BTCUSDT funding rates from DB...');
  const fundingRates = await prisma.fundingRateDetail.findMany({
    where: { symbol: 'BTCUSDT' },
    orderBy: { timestamp: 'asc' },
    select: {
      timestamp: true,
      rate: true,
    },
  });

  console.log(`Loaded ${fundingRates.length} records\n`);

  // Define parameter grid
  const entryThresholds = [0.0005, 0.001, 0.0015, 0.002, 0.0025, 0.003]; // 0.05% ~ 0.3%
  const exitThresholds = [-0.001, 0.0, 0.0005, 0.001]; // -0.1% ~ 0.1%
  const avgDaysList = [3, 5, 7]; // 3, 5, 7 days

  console.log('Parameter Grid:');
  console.log(`  Entry Thresholds: ${entryThresholds.map(t => (t * 100).toFixed(2) + '%').join(', ')}`);
  console.log(`  Exit Thresholds: ${exitThresholds.map(t => (t * 100).toFixed(2) + '%').join(', ')}`);
  console.log(`  Avg Days: ${avgDaysList.join(', ')}`);
  console.log(`  Total Combinations: ${entryThresholds.length * exitThresholds.length * avgDaysList.length}\n`);

  // Run grid search
  console.log('Running grid search...\n');
  const engine = new FundingArbEngine();
  const results = engine.gridSearch(
    fundingRates,
    entryThresholds,
    exitThresholds,
    avgDaysList,
    100000 // Initial capital: ¥100,000
  );

  // Sort by Sharpe ratio (descending)
  results.sort((a, b) => b.sharpeRatio - a.sharpeRatio);

  // Display top 10 results
  console.log('='.repeat(100));
  console.log('TOP 10 PARAMETER COMBINATIONS (sorted by Sharpe Ratio)');
  console.log('='.repeat(100));

  for (let i = 0; i < Math.min(10, results.length); i++) {
    const r = results[i];
    console.log(`\n#${i + 1}`);
    console.log(`  Parameters:`);
    console.log(`    Entry: ${r.params.avgDays}-day avg > ${(r.params.entryThreshold * 100).toFixed(3)}%`);
    console.log(`    Exit:  ${r.params.avgDays}-day avg < ${(r.params.exitThreshold * 100).toFixed(3)}%`);
    console.log(`  Performance:`);
    console.log(`    Sharpe Ratio:      ${r.sharpeRatio.toFixed(2)}`);
    console.log(`    Calmar Ratio:      ${r.calmarRatio.toFixed(2)}`);
    console.log(`    Annualized Return: ${r.annualizedReturn.toFixed(2)}%`);
    console.log(`    Max Drawdown:      ${r.maxDrawdown.toFixed(2)}%`);
    console.log(`    Win Rate:          ${r.winRate.toFixed(1)}%`);
    console.log(`    Total Trades:      ${r.totalTrades}`);
    console.log(`    Avg Holding:       ${r.avgHoldingDays.toFixed(1)} days`);
    console.log(`    Position Hold:     ${r.positionHoldPercent.toFixed(1)}%`);
  }

  console.log('\n' + '='.repeat(100));

  // Best result
  const best = results[0];
  console.log('\n🏆 BEST STRATEGY:');
  console.log(`  Entry: ${best.params.avgDays}-day avg > ${(best.params.entryThreshold * 100).toFixed(3)}%`);
  console.log(`  Exit:  ${best.params.avgDays}-day avg < ${(best.params.exitThreshold * 100).toFixed(3)}%`);
  console.log(`\n  Sharpe: ${best.sharpeRatio.toFixed(2)} | Calmar: ${best.calmarRatio.toFixed(2)} | Return: ${best.annualizedReturn.toFixed(2)}% | Max DD: ${best.maxDrawdown.toFixed(2)}%`);

  // Detailed trades for best strategy
  console.log(`\n  Total Trades: ${best.totalTrades}`);
  if (best.trades.length > 0) {
    console.log(`\n  First 5 Trades:`);
    for (let i = 0; i < Math.min(5, best.trades.length); i++) {
      const t = best.trades[i];
      console.log(
        `    ${i + 1}. Entry: ${t.entryDate.toISOString().slice(0, 10)} (${(t.entryRate * 100).toFixed(3)}%) | ` +
        `Exit: ${t.exitDate?.toISOString().slice(0, 10)} (${((t.exitRate || 0) * 100).toFixed(3)}%) | ` +
        `Holding: ${(t.holdingPeriods / 3).toFixed(1)}d | ` +
        `Earned: ¥${t.fundingEarned.toFixed(0)}`
      );
    }
  }

  console.log('\n' + '='.repeat(100));
  console.log('\n✓ Backtest complete!');
}

main()
  .catch((error) => {
    console.error('Error running backtest:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
