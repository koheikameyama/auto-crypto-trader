import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { fetchFundingDaily } from "../src/data/funding-loader.js";

const prisma = new PrismaClient();
const SYMBOL = "BTCUSDT";

async function main() {
  // Binance BTCUSDT perp launched Sep 2019. Fetch from 2019-10-01 for safety.
  const start = dayjs("2019-10-01");
  const end = dayjs();
  const startIso = start.format("YYYY-MM-DD");
  const endIso = end.format("YYYY-MM-DD");

  console.log(`Funding backfill: ${startIso} → ${endIso} (symbol=${SYMBOL})`);

  const bars = await fetchFundingDaily(SYMBOL, startIso, endIso);
  console.log(`Fetched ${bars.length} daily funding rows`);

  if (bars.length === 0) return;

  const result = await prisma.fundingRate.createMany({
    data: bars.map((b) => ({
      symbol: SYMBOL,
      date: b.date,
      avgRate: b.avgRate,
      count: b.count,
    })),
    skipDuplicates: true,
  });
  console.log(`Inserted ${result.count} new rows`);

  const total = await prisma.fundingRate.count({ where: { symbol: SYMBOL } });
  console.log(`Total FundingRate rows for ${SYMBOL}: ${total}`);

  // Summary stats
  const sample = await prisma.fundingRate.findMany({
    where: { symbol: SYMBOL },
    orderBy: { date: "asc" },
    take: 5,
  });
  console.log(`First 5 rows:`);
  for (const r of sample) {
    console.log(
      `  ${r.date.toISOString().slice(0, 10)}: avgRate=${(r.avgRate * 100).toFixed(5)}% | count=${r.count}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
