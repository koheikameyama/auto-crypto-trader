/**
 * Check collected funding rate data
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Checking collected funding rate data...\n');

  // Count records
  const btcCount = await prisma.fundingRateDetail.count({
    where: { symbol: 'BTCUSDT' },
  });
  const ethCount = await prisma.fundingRateDetail.count({
    where: { symbol: 'ETHUSDT' },
  });

  console.log(`Total records:`);
  console.log(`  BTCUSDT: ${btcCount}`);
  console.log(`  ETHUSDT: ${ethCount}`);
  console.log(`  Total: ${btcCount + ethCount}\n`);

  // Date range
  for (const symbol of ['BTCUSDT', 'ETHUSDT']) {
    const oldest = await prisma.fundingRateDetail.findFirst({
      where: { symbol },
      orderBy: { timestamp: 'asc' },
    });
    const newest = await prisma.fundingRateDetail.findFirst({
      where: { symbol },
      orderBy: { timestamp: 'desc' },
    });

    console.log(`${symbol}:`);
    console.log(`  Oldest: ${oldest?.timestamp.toISOString()}`);
    console.log(`  Newest: ${newest?.timestamp.toISOString()}`);

    if (oldest && newest) {
      const days = Math.floor(
        (newest.timestamp.getTime() - oldest.timestamp.getTime()) / (1000 * 60 * 60 * 24)
      );
      console.log(`  Range: ${days} days\n`);
    }
  }

  // Average funding rate
  for (const symbol of ['BTCUSDT', 'ETHUSDT']) {
    const rates = await prisma.fundingRateDetail.findMany({
      where: { symbol },
      select: { rate: true },
    });

    const avg = rates.reduce((sum, r) => sum + r.rate, 0) / rates.length;
    const min = Math.min(...rates.map(r => r.rate));
    const max = Math.max(...rates.map(r => r.rate));

    console.log(`${symbol} statistics:`);
    console.log(`  Average: ${(avg * 100).toFixed(4)}% (annualized: ${(avg * 3 * 365 * 100).toFixed(2)}%)`);
    console.log(`  Min: ${(min * 100).toFixed(4)}%`);
    console.log(`  Max: ${(max * 100).toFixed(4)}%\n`);
  }

  // Recent 10 rates
  console.log('Recent 10 BTCUSDT funding rates:');
  const recent = await prisma.fundingRateDetail.findMany({
    where: { symbol: 'BTCUSDT' },
    orderBy: { timestamp: 'desc' },
    take: 10,
  });

  recent.forEach((r, i) => {
    console.log(
      `  ${i + 1}. ${r.timestamp.toISOString()} → ${(r.rate * 100).toFixed(4)}%`
    );
  });
}

main()
  .catch((error) => {
    console.error('Error checking funding data:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
