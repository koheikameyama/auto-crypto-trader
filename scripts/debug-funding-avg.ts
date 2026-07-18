/**
 * Debug: Check 3-day moving average of funding rates
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Debugging 3-day moving average of funding rates...\n');

  // Load funding rate data
  const fundingRates = await prisma.fundingRateDetail.findMany({
    where: { symbol: 'BTCUSDT' },
    orderBy: { timestamp: 'asc' },
    select: {
      timestamp: true,
      rate: true,
    },
  });

  console.log(`Loaded ${fundingRates.length} records\n`);

  // Calculate 3-day moving average (9 periods)
  const avgPeriods = 9; // 3 days * 3 periods per day
  const movingAvgs: { timestamp: Date; avg: number }[] = [];

  for (let i = avgPeriods - 1; i < fundingRates.length; i++) {
    const slice = fundingRates.slice(i - avgPeriods + 1, i + 1);
    const avg = slice.reduce((sum, r) => sum + r.rate, 0) / slice.length;
    movingAvgs.push({ timestamp: fundingRates[i].timestamp, avg });
  }

  // Statistics
  const avgValues = movingAvgs.map(m => m.avg);
  const min = Math.min(...avgValues);
  const max = Math.max(...avgValues);
  const mean = avgValues.reduce((sum, v) => sum + v, 0) / avgValues.length;

  console.log('3-day moving average statistics:');
  console.log(`  Min:  ${(min * 100).toFixed(4)}%`);
  console.log(`  Max:  ${(max * 100).toFixed(4)}%`);
  console.log(`  Mean: ${(mean * 100).toFixed(4)}%\n`);

  // Count periods above threshold
  const thresholds = [0.0005, 0.001, 0.002, 0.003, 0.005];
  console.log('Periods above threshold:');
  for (const threshold of thresholds) {
    const count = avgValues.filter(v => v > threshold).length;
    const percent = (count / avgValues.length) * 100;
    console.log(`  > ${(threshold * 100).toFixed(2)}%: ${count} / ${avgValues.length} (${percent.toFixed(1)}%)`);
  }

  // Show top 10 highest 3-day averages
  const sorted = movingAvgs.sort((a, b) => b.avg - a.avg);
  console.log('\nTop 10 highest 3-day averages:');
  for (let i = 0; i < Math.min(10, sorted.length); i++) {
    const m = sorted[i];
    console.log(`  ${i + 1}. ${m.timestamp.toISOString().slice(0, 10)} → ${(m.avg * 100).toFixed(4)}%`);
  }

  // Show bottom 10 lowest 3-day averages
  const sortedLow = movingAvgs.sort((a, b) => a.avg - b.avg);
  console.log('\nBottom 10 lowest 3-day averages:');
  for (let i = 0; i < Math.min(10, sortedLow.length); i++) {
    const m = sortedLow[i];
    console.log(`  ${i + 1}. ${m.timestamp.toISOString().slice(0, 10)} → ${(m.avg * 100).toFixed(4)}%`);
  }
}

main()
  .catch((error) => {
    console.error('Error:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
