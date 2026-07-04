import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { fetchFundingDaily } from "../src/data/funding-loader.js";

// Generalized funding-rate backfill for any Binance USDT-M perp symbol.
// A parametrized version of backfill-eth-funding.ts.
//
// Usage:
//   npx tsx scripts/backfill-alt-funding.ts --symbol=SOLUSDT --start=2020-09-01
//   npx tsx scripts/backfill-alt-funding.ts --symbol=BNBUSDT --start=2020-02-01

const prisma = new PrismaClient();

interface CliArgs {
  symbol: string;
  start: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let symbol: string | undefined;
  let start: string | undefined;
  for (const a of args) {
    if (a.startsWith("--symbol=")) symbol = a.slice("--symbol=".length);
    else if (a.startsWith("--start=")) start = a.slice("--start=".length);
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!symbol || !start) {
    throw new Error("Required: --symbol=<BINANCE_PERP> --start=YYYY-MM-DD");
  }
  return { symbol, start };
}

async function main() {
  const { symbol, start } = parseArgs();
  const startIso = dayjs(start).format("YYYY-MM-DD");
  const endIso = dayjs().format("YYYY-MM-DD");

  console.log(`${symbol} funding backfill: ${startIso} → ${endIso}`);

  const bars = await fetchFundingDaily(symbol, startIso, endIso);
  console.log(`Fetched ${bars.length} daily rows`);

  if (bars.length === 0) return;

  const result = await prisma.fundingRate.createMany({
    data: bars.map((b) => ({
      symbol,
      date: b.date,
      avgRate: b.avgRate,
      count: b.count,
    })),
    skipDuplicates: true,
  });
  console.log(`Inserted ${result.count} new rows`);

  const total = await prisma.fundingRate.count({ where: { symbol } });
  console.log(`Total FundingRate rows for ${symbol}: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
