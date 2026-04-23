import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { fetchMacroDaily } from "../src/data/macro-loader.js";

const prisma = new PrismaClient();

const TICKERS = ["DX-Y.NYB", "^VIX", "^TNX"];

async function main() {
  const years = 10;
  const end = dayjs();
  const start = end.subtract(years, "year");
  const startIso = start.format("YYYY-MM-DD");
  const endIso = end.format("YYYY-MM-DD");

  console.log(`Macro backfill: ${startIso} → ${endIso} (${years}y)`);

  for (const ticker of TICKERS) {
    console.log(`\nFetching ${ticker}...`);
    const bars = await fetchMacroDaily(ticker, startIso, endIso);
    console.log(`  ${bars.length} bars`);

    if (bars.length === 0) continue;

    const result = await prisma.macroBar.createMany({
      data: bars.map((b) => ({
        ticker,
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      })),
      skipDuplicates: true,
    });
    console.log(`  inserted ${result.count} new rows`);
  }

  console.log("\n=== Final row counts ===");
  for (const ticker of TICKERS) {
    const count = await prisma.macroBar.count({ where: { ticker } });
    console.log(`  ${ticker}: ${count} bars`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
