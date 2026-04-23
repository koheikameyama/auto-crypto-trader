import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { fetchFundingDaily } from "../src/data/funding-loader.js";

const prisma = new PrismaClient();
const SYMBOL = "ETHUSDT";

async function main() {
  // Binance ETHUSDT perp launched ~Nov 2019
  const start = dayjs("2019-11-01");
  const end = dayjs();
  const startIso = start.format("YYYY-MM-DD");
  const endIso = end.format("YYYY-MM-DD");

  console.log(`ETH funding backfill: ${startIso} → ${endIso}`);

  const bars = await fetchFundingDaily(SYMBOL, startIso, endIso);
  console.log(`Fetched ${bars.length} daily rows`);

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
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
