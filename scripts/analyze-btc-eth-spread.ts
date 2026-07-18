/**
 * BTC-ETH Spread Analysis for Market Neutral Strategy
 *
 * Analyzes cointegration, correlation, and spread characteristics
 * to determine viability of BTC/ETH pair trading strategy.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface PriceData {
  date: Date;
  btcPrice: number;
  ethPrice: number;
  ratio: number;
  logRatio: number;
}

async function main() {
  console.log('='.repeat(80));
  console.log('BTC-ETH Spread Analysis for Market Neutral Strategy');
  console.log('='.repeat(80));

  // Load BTC and ETH assets
  console.log('\nLoading assets...');
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

  console.log(`  BTC asset ID: ${btcAsset.id}`);
  console.log(`  ETH asset ID: ${ethAsset.id}`);

  // Load BTC and ETH price data
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

  console.log(`  BTC records: ${btcBars.length}`);
  console.log(`  ETH records: ${ethBars.length}`);

  // Create price map
  const btcMap = new Map(btcBars.map(b => [b.date.toISOString().slice(0, 10), b.close]));
  const ethMap = new Map(ethBars.map(b => [b.date.toISOString().slice(0, 10), b.close]));

  // Find common dates
  const commonDates = btcBars
    .map(b => b.date.toISOString().slice(0, 10))
    .filter(date => ethMap.has(date));

  console.log(`  Common dates: ${commonDates.length}`);

  // Build price series
  const priceData: PriceData[] = commonDates.map(date => {
    const btcPrice = btcMap.get(date)!;
    const ethPrice = ethMap.get(date)!;
    const ratio = btcPrice / ethPrice;
    const logRatio = Math.log(ratio);

    return {
      date: new Date(date),
      btcPrice,
      ethPrice,
      ratio,
      logRatio,
    };
  });

  if (priceData.length === 0) {
    console.error('\n❌ No common price data found!');
    return;
  }

  console.log(`  Date range: ${priceData[0].date.toISOString().slice(0, 10)} to ${priceData[priceData.length - 1].date.toISOString().slice(0, 10)}`);

  // === 1. Correlation Analysis ===
  console.log('\n' + '='.repeat(80));
  console.log('1. CORRELATION ANALYSIS');
  console.log('='.repeat(80));

  const btcPrices = priceData.map(p => p.btcPrice);
  const ethPrices = priceData.map(p => p.ethPrice);

  const correlation = calculateCorrelation(btcPrices, ethPrices);
  console.log(`\nPrice correlation: ${correlation.toFixed(4)}`);

  // Price returns correlation
  const btcReturns = calculateReturns(btcPrices);
  const ethReturns = calculateReturns(ethPrices);
  const returnsCorrelation = calculateCorrelation(btcReturns, ethReturns);
  console.log(`Returns correlation: ${returnsCorrelation.toFixed(4)}`);

  // === 2. Ratio Statistics ===
  console.log('\n' + '='.repeat(80));
  console.log('2. BTC/ETH RATIO STATISTICS');
  console.log('='.repeat(80));

  const ratios = priceData.map(p => p.ratio);
  const ratioStats = calculateStats(ratios);

  console.log(`\nRatio (BTC/ETH):`);
  console.log(`  Mean:   ${ratioStats.mean.toFixed(2)}`);
  console.log(`  Std:    ${ratioStats.std.toFixed(2)}`);
  console.log(`  Min:    ${ratioStats.min.toFixed(2)}`);
  console.log(`  Max:    ${ratioStats.max.toFixed(2)}`);
  console.log(`  Range:  ${(ratioStats.max - ratioStats.min).toFixed(2)}`);
  console.log(`  CV:     ${(ratioStats.std / ratioStats.mean * 100).toFixed(2)}%`);

  // === 3. Spread Mean Reversion ===
  console.log('\n' + '='.repeat(80));
  console.log('3. SPREAD MEAN REVERSION');
  console.log('='.repeat(80));

  // Calculate z-score of ratio
  const zScores = ratios.map(r => (r - ratioStats.mean) / ratioStats.std);

  // Count excursions
  const thresholds = [1.0, 1.5, 2.0, 2.5, 3.0];
  console.log('\nZ-score excursions (potential entry signals):');

  for (const threshold of thresholds) {
    const aboveCount = zScores.filter(z => z > threshold).length;
    const belowCount = zScores.filter(z => z < -threshold).length;
    const totalExcursions = aboveCount + belowCount;
    const percentage = (totalExcursions / zScores.length * 100).toFixed(1);

    console.log(`  |z| > ${threshold.toFixed(1)}: ${totalExcursions} times (${percentage}%)`);
  }

  // === 4. Recent Spread Behavior (last 90 days) ===
  console.log('\n' + '='.repeat(80));
  console.log('4. RECENT SPREAD BEHAVIOR (Last 90 Days)');
  console.log('='.repeat(80));

  const recentData = priceData.slice(-90);
  const recentRatios = recentData.map(p => p.ratio);
  const recentStats = calculateStats(recentRatios);

  console.log(`\nRecent ratio statistics:`);
  console.log(`  Mean:   ${recentStats.mean.toFixed(2)} (vs overall ${ratioStats.mean.toFixed(2)})`);
  console.log(`  Std:    ${recentStats.std.toFixed(2)} (vs overall ${ratioStats.std.toFixed(2)})`);
  console.log(`  Current: ${recentRatios[recentRatios.length - 1].toFixed(2)}`);
  console.log(`  Z-score: ${((recentRatios[recentRatios.length - 1] - recentStats.mean) / recentStats.std).toFixed(2)}`);

  // === 5. Half-life of Mean Reversion ===
  console.log('\n' + '='.repeat(80));
  console.log('5. MEAN REVERSION SPEED');
  console.log('='.repeat(80));

  const halfLife = calculateHalfLife(ratios);
  console.log(`\nHalf-life: ${halfLife.toFixed(1)} days`);
  console.log(`Interpretation: On average, spread deviations decay by 50% in ${halfLife.toFixed(1)} days`);

  if (halfLife < 30) {
    console.log('✅ Fast mean reversion - good for pair trading');
  } else if (halfLife < 60) {
    console.log('⚠️ Moderate mean reversion - acceptable for pair trading');
  } else {
    console.log('❌ Slow mean reversion - not ideal for pair trading');
  }

  // === Summary ===
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY & RECOMMENDATION');
  console.log('='.repeat(80));

  console.log('\nKey Metrics:');
  console.log(`  1. Price correlation: ${correlation.toFixed(4)} (${correlation > 0.8 ? '✅ High' : '⚠️ Moderate'})`);
  console.log(`  2. Returns correlation: ${returnsCorrelation.toFixed(4)}`);
  console.log(`  3. Ratio CV: ${(ratioStats.std / ratioStats.mean * 100).toFixed(2)}%`);
  console.log(`  4. Half-life: ${halfLife.toFixed(1)} days (${halfLife < 30 ? '✅ Good' : halfLife < 60 ? '⚠️ OK' : '❌ Poor'})`);
  console.log(`  5. Current z-score: ${((recentRatios[recentRatios.length - 1] - recentStats.mean) / recentStats.std).toFixed(2)}`);

  console.log('\n' + '='.repeat(80));
  console.log('\n✓ Analysis complete! Next steps:');
  console.log('  1. Run cointegration test (Engle-Granger)');
  console.log('  2. Backtest entry/exit rules with z-score thresholds');
  console.log('  3. Estimate transaction costs and slippage');
  console.log('  4. Calculate expected Sharpe and Calmar ratios');
  console.log('\n' + '='.repeat(80));
}

// === Helper Functions ===

function calculateCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  const meanX = x.reduce((sum, val) => sum + val, 0) / n;
  const meanY = y.reduce((sum, val) => sum + val, 0) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  return numerator / Math.sqrt(denomX * denomY);
}

function calculateReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
  }
  return returns;
}

function calculateStats(values: number[]) {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  const std = Math.sqrt(variance);
  const min = Math.min(...values);
  const max = Math.max(...values);

  return { mean, std, min, max };
}

function calculateHalfLife(spread: number[]): number {
  // Simple AR(1) regression: spread[t] = alpha + beta * spread[t-1] + error
  // Half-life = -ln(2) / ln(beta)

  const y = spread.slice(1); // spread[t]
  const x = spread.slice(0, -1); // spread[t-1]

  // OLS regression
  const n = y.length;
  const meanX = x.reduce((sum, v) => sum + v, 0) / n;
  const meanY = y.reduce((sum, v) => sum + v, 0) / n;

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denominator += dx * dx;
  }

  const beta = numerator / denominator;
  const halfLife = -Math.log(2) / Math.log(Math.abs(beta));

  return halfLife;
}

main()
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
