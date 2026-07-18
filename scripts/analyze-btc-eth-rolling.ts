/**
 * BTC-ETH Rolling Window Analysis
 *
 * Analyze half-life and mean reversion characteristics
 * over different time windows to detect regime changes.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

interface PriceData {
  date: Date;
  btcPrice: number;
  ethPrice: number;
  ratio: number;
}

async function main() {
  console.log('='.repeat(80));
  console.log('BTC-ETH Rolling Window Analysis');
  console.log('='.repeat(80));

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
  const priceData: PriceData[] = commonDates.map(date => {
    const btcPrice = btcMap.get(date)!;
    const ethPrice = ethMap.get(date)!;
    const ratio = btcPrice / ethPrice;

    return {
      date: new Date(date),
      btcPrice,
      ethPrice,
      ratio,
    };
  });

  console.log(`\nTotal data points: ${priceData.length}`);
  console.log(`Date range: ${priceData[0].date.toISOString().slice(0, 10)} to ${priceData[priceData.length - 1].date.toISOString().slice(0, 10)}`);

  // === Analyze different windows ===
  console.log('\n' + '='.repeat(80));
  console.log('HALF-LIFE ANALYSIS BY WINDOW');
  console.log('='.repeat(80));

  const windows = [
    { name: 'Last 3 months', days: 90 },
    { name: 'Last 6 months', days: 180 },
    { name: 'Last 1 year', days: 365 },
    { name: 'Last 2 years', days: 730 },
    { name: 'Last 3 years', days: 1095 },
    { name: 'All time', days: priceData.length },
  ];

  const results: Array<{ name: string; days: number; halfLife: number; correlation: number; cv: number }> = [];

  for (const window of windows) {
    const windowData = priceData.slice(-Math.min(window.days, priceData.length));
    const ratios = windowData.map(p => p.ratio);

    if (ratios.length < 30) {
      console.log(`\n${window.name}: Insufficient data (${ratios.length} days)`);
      continue;
    }

    const halfLife = calculateHalfLife(ratios);
    const correlation = calculateAutocorrelation(ratios, 1);
    const stats = calculateStats(ratios);
    const cv = (stats.std / stats.mean) * 100;

    results.push({
      name: window.name,
      days: windowData.length,
      halfLife,
      correlation,
      cv,
    });

    const verdict = halfLife < 30 ? '✅ Good' : halfLife < 60 ? '⚠️ OK' : '❌ Poor';

    console.log(`\n${window.name} (${windowData.length} days):`);
    console.log(`  Half-life:       ${halfLife.toFixed(1)} days ${verdict}`);
    console.log(`  Auto-corr (lag1): ${correlation.toFixed(4)}`);
    console.log(`  Ratio mean:      ${stats.mean.toFixed(2)}`);
    console.log(`  Ratio std:       ${stats.std.toFixed(2)}`);
    console.log(`  CV:              ${cv.toFixed(2)}%`);
  }

  // === Summary table ===
  console.log('\n' + '='.repeat(80));
  console.log('SUMMARY TABLE');
  console.log('='.repeat(80));
  console.log('\n| Window        | Days | Half-Life | Auto-Corr | CV    | Verdict |');
  console.log('|---------------|------|-----------|-----------|-------|---------|');

  for (const r of results) {
    const verdict = r.halfLife < 30 ? '✅ Good' : r.halfLife < 60 ? '⚠️ OK' : '❌ Poor';
    console.log(
      `| ${r.name.padEnd(13)} | ${r.days.toString().padStart(4)} | ` +
      `${r.halfLife.toFixed(1).padStart(9)} | ` +
      `${r.correlation.toFixed(4).padStart(9)} | ` +
      `${r.cv.toFixed(1).padStart(5)}% | ` +
      `${verdict.padEnd(7)} |`
    );
  }

  // === Recent trend analysis ===
  console.log('\n' + '='.repeat(80));
  console.log('RECENT TREND ANALYSIS (Last 90 Days)');
  console.log('='.repeat(80));

  const recent90 = priceData.slice(-90);
  const ratios90 = recent90.map(p => p.ratio);
  const stats90 = calculateStats(ratios90);

  console.log(`\nRatio statistics:`);
  console.log(`  Mean:    ${stats90.mean.toFixed(2)}`);
  console.log(`  Std:     ${stats90.std.toFixed(2)}`);
  console.log(`  Min:     ${stats90.min.toFixed(2)}`);
  console.log(`  Max:     ${stats90.max.toFixed(2)}`);
  console.log(`  Current: ${ratios90[ratios90.length - 1].toFixed(2)}`);

  const trend = calculateTrend(ratios90);
  console.log(`\nTrend: ${trend > 0 ? '📈 Upward' : '📉 Downward'} (${(trend * 100).toFixed(2)}% per day)`);

  // === Recommendation ===
  console.log('\n' + '='.repeat(80));
  console.log('RECOMMENDATION');
  console.log('='.repeat(80));

  const recent1YearHalfLife = results.find(r => r.name === 'Last 1 year')?.halfLife || Infinity;
  const recent6MonthHalfLife = results.find(r => r.name === 'Last 6 months')?.halfLife || Infinity;
  const recent3MonthHalfLife = results.find(r => r.name === 'Last 3 months')?.halfLife || Infinity;

  console.log('\nKey Findings:');
  console.log(`  1. Recent 3-month half-life: ${recent3MonthHalfLife.toFixed(1)} days`);
  console.log(`  2. Recent 6-month half-life: ${recent6MonthHalfLife.toFixed(1)} days`);
  console.log(`  3. Recent 1-year half-life:  ${recent1YearHalfLife.toFixed(1)} days`);

  if (recent3MonthHalfLife < 30) {
    console.log('\n✅ PROCEED: Recent data shows fast mean reversion');
    console.log('   → Move to backtest with 3-month rolling parameters');
  } else if (recent6MonthHalfLife < 60) {
    console.log('\n⚠️ MARGINAL: Recent data shows moderate mean reversion');
    console.log('   → Proceed with caution, use conservative parameters');
  } else {
    console.log('\n❌ ABORT: No improvement in recent windows');
    console.log('   → BTC-ETH pair trading is NOT viable');
    console.log('   → Recommend: Focus on Phase 2 or explore other strategies');
  }

  console.log('\n' + '='.repeat(80));
}

// === Helper Functions ===

function calculateHalfLife(spread: number[]): number {
  const y = spread.slice(1);
  const x = spread.slice(0, -1);

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

function calculateAutocorrelation(values: number[], lag: number): number {
  const n = values.length - lag;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < values.length; i++) {
    const dev = values[i] - mean;
    denominator += dev * dev;

    if (i < n) {
      numerator += dev * (values[i + lag] - mean);
    }
  }

  return numerator / denominator;
}

function calculateStats(values: number[]) {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
  const std = Math.sqrt(variance);
  const min = Math.min(...values);
  const max = Math.max(...values);

  return { mean, std, min, max };
}

function calculateTrend(values: number[]): number {
  // Simple linear regression slope
  const n = values.length;
  const x = Array.from({ length: n }, (_, i) => i);
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((sum, v) => sum + v, 0) / n;

  let numerator = 0;
  let denominator = 0;

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = values[i] - meanY;
    numerator += dx * dy;
    denominator += dx * dx;
  }

  return numerator / denominator;
}

main()
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
