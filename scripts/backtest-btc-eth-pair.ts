/**
 * Backtest BTC-ETH Pair Trading Strategy
 */

import { PrismaClient } from '@prisma/client';
import { PairTradingEngine, PriceData } from '../src/backtest/pair-trading-engine.js';

const prisma = new PrismaClient();

async function main() {
  console.log('='.repeat(100));
  console.log('BTC-ETH PAIR TRADING BACKTEST');
  console.log('='.repeat(100));

  // Load BTC and ETH assets
  const btcAsset = await prisma.asset.findUnique({
    where: { symbol: 'BTC-USD' },
  });

  const ethAsset = await prisma.asset.findUnique({
    where: { symbol: 'ETH-USD' },
  });

  if (!btcAsset || !ethAsset) {
    console.error('\n❌ BTC or ETH asset not found in database!');
    return;
  }

  // Load price data
  console.log('\nLoading price data...');
  const btcBars = await prisma.dailyBar.findMany({
    where: { assetId: btcAsset.id },
    orderBy: { date: 'asc' },
    select: { date: true, close: true },
  });

  const ethBars = await prisma.dailyBar.findMany({
    where: { assetId: ethAsset.id },
    orderBy: { date: 'asc' },
    select: { date: true, close: true },
  });

  // Create price map
  const btcMap = new Map(btcBars.map(b => [b.date.toISOString().slice(0, 10), b.close]));
  const ethMap = new Map(ethBars.map(b => [b.date.toISOString().slice(0, 10), b.close]));

  // Find common dates
  const commonDates = btcBars
    .map(b => b.date.toISOString().slice(0, 10))
    .filter(date => ethMap.has(date));

  // Build price series
  const allPriceData: PriceData[] = commonDates.map(date => ({
    date: new Date(date),
    btcPrice: btcMap.get(date)!,
    ethPrice: ethMap.get(date)!,
  }));

  console.log(`  Total data points: ${allPriceData.length}`);
  console.log(`  Date range: ${allPriceData[0].date.toISOString().slice(0, 10)} to ${allPriceData[allPriceData.length - 1].date.toISOString().slice(0, 10)}`);

  // Use recent 6 months for backtest
  const priceData = allPriceData.slice(-180);
  console.log(`\nUsing last 180 days for backtest:`);
  console.log(`  Start: ${priceData[0].date.toISOString().slice(0, 10)}`);
  console.log(`  End:   ${priceData[priceData.length - 1].date.toISOString().slice(0, 10)}`);

  // Parameter grid
  const entryThresholds = [1.0, 1.5, 2.0];
  const exitThresholds = [0.0, -0.5]; // 0 = mean reversion, -0.5 = opposite signal
  const lookbackDays = [90, 120, 180];

  console.log('\nParameter Grid:');
  console.log(`  Entry thresholds: ${entryThresholds.join(', ')}`);
  console.log(`  Exit thresholds:  ${exitThresholds.join(', ')}`);
  console.log(`  Lookback days:    ${lookbackDays.join(', ')}`);
  console.log(`  Total combinations: ${entryThresholds.length * exitThresholds.length * lookbackDays.length}`);

  // Run grid search
  console.log('\nRunning grid search...\n');
  const engine = new PairTradingEngine();
  const results = engine.gridSearch(
    priceData,
    entryThresholds,
    exitThresholds,
    lookbackDays,
    10000, // $10,000 initial capital
    0.0002 // 0.02% fee (Binance maker)
  );

  // Sort by Sharpe ratio
  results.sort((a, b) => b.sharpeRatio - a.sharpeRatio);

  // Display top 10 results
  console.log('='.repeat(100));
  console.log('TOP 10 PARAMETER COMBINATIONS (sorted by Sharpe Ratio)');
  console.log('='.repeat(100));

  for (let i = 0; i < Math.min(10, results.length); i++) {
    const r = results[i];
    console.log(`\n#${i + 1}`);
    console.log(`  Parameters:`);
    console.log(`    Entry: z-score > ${r.params.entryThreshold.toFixed(1)}`);
    console.log(`    Exit:  z-score < ${r.params.exitThreshold.toFixed(1)}`);
    console.log(`    Lookback: ${r.params.lookbackDays} days`);
    console.log(`  Performance:`);
    console.log(`    Sharpe Ratio:      ${r.sharpeRatio.toFixed(2)}`);
    console.log(`    Calmar Ratio:      ${r.calmarRatio.toFixed(2)}`);
    console.log(`    Annualized Return: ${r.annualizedReturn.toFixed(2)}%`);
    console.log(`    Max Drawdown:      ${r.maxDrawdown.toFixed(2)}%`);
    console.log(`    Win Rate:          ${r.winRate.toFixed(1)}%`);
    console.log(`    Total Trades:      ${r.totalTrades}`);
    console.log(`    Avg Holding:       ${r.avgHoldingDays.toFixed(1)} days`);
  }

  // Best result
  const best = results[0];
  console.log('\n' + '='.repeat(100));
  console.log('🏆 BEST STRATEGY:');
  console.log(`  Entry: z-score > ${best.params.entryThreshold.toFixed(1)}`);
  console.log(`  Exit:  z-score < ${best.params.exitThreshold.toFixed(1)}`);
  console.log(`  Lookback: ${best.params.lookbackDays} days`);
  console.log(`\n  Sharpe: ${best.sharpeRatio.toFixed(2)} | Calmar: ${best.calmarRatio.toFixed(2)} | Return: ${best.annualizedReturn.toFixed(2)}% | Max DD: ${best.maxDrawdown.toFixed(2)}%`);

  // Detailed trades
  console.log(`\n  Total Trades: ${best.totalTrades}`);
  if (best.trades.length > 0) {
    console.log(`\n  First 5 Trades:`);
    for (let i = 0; i < Math.min(5, best.trades.length); i++) {
      const t = best.trades[i];
      console.log(
        `    ${i + 1}. ${t.side.toUpperCase()}: ` +
        `Entry ${t.entryDate.toISOString().slice(0, 10)} (z=${t.entryZScore.toFixed(2)}) → ` +
        `Exit ${t.exitDate?.toISOString().slice(0, 10)} (z=${t.exitZScore?.toFixed(2)}) | ` +
        `Hold: ${t.holdingDays}d | Return: ${t.returnPct.toFixed(2)}%`
      );
    }
  }

  // === Verdict ===
  console.log('\n' + '='.repeat(100));
  console.log('VERDICT');
  console.log('='.repeat(100));

  console.log(`\nBest Sharpe Ratio: ${best.sharpeRatio.toFixed(2)}`);

  if (best.sharpeRatio > 1.5 && best.totalTrades >= 5) {
    console.log('\n✅ STRONG PROCEED: Excellent risk-adjusted returns');
    console.log('   → Recommend Phase 3.1 implementation');
    console.log('   → Start with dry-run, then minimum lot');
  } else if (best.sharpeRatio > 0.8 && best.totalTrades >= 3) {
    console.log('\n⚠️ CONDITIONAL PROCEED: Moderate returns');
    console.log('   → Acceptable but not stellar');
    console.log('   → Proceed with caution, monitor closely');
    console.log('   → Consider waiting for better market conditions');
  } else {
    console.log('\n❌ DO NOT PROCEED: Insufficient returns or trades');
    console.log('   → Sharpe too low or insufficient trade opportunities');
    console.log('   → Recommend: Focus on Phase 2 optimization');
    console.log('   → Re-evaluate quarterly when market regime changes');
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
