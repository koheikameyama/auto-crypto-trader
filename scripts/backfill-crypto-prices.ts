import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { ASSETS } from "../src/types/asset.js";
import { getAssetConfig } from "../src/data/asset-config.js";
import { fetchCryptoDaily } from "../src/data/price-loader.js";
import type { AssetSymbol } from "../src/types/asset.js";

const prisma = new PrismaClient();

interface CliArgs {
  years: number;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let years = 10;
  let dryRun = false;
  for (const a of args) {
    if (a.startsWith("--years=")) {
      years = Number(a.slice("--years=".length));
      if (!Number.isFinite(years) || years <= 0) {
        throw new Error(`Invalid --years value: ${a}`);
      }
    } else if (a === "--dry-run") {
      dryRun = true;
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return { years, dryRun };
}

async function upsertAssetRow(symbol: AssetSymbol) {
  const cfg = getAssetConfig(symbol);
  return prisma.asset.upsert({
    where: { symbol },
    create: {
      symbol,
      yfinanceTicker: cfg.yfinanceTicker,
      feeRate: cfg.feeRate,
    },
    update: {
      feeRate: cfg.feeRate,
    },
  });
}

async function main() {
  const { years, dryRun } = parseArgs();
  const end = dayjs();
  const start = end.subtract(years, "year");
  const startIso = start.format("YYYY-MM-DD");
  const endIso = end.format("YYYY-MM-DD");

  console.log(
    `Backfill range: ${startIso} → ${endIso} (${years} year${years === 1 ? "" : "s"})`,
  );
  if (dryRun) console.log("(dry-run: no DB writes)");

  for (const symbol of ASSETS) {
    console.log(`\nFetching ${symbol}...`);
    const bars = await fetchCryptoDaily(symbol, startIso, endIso);
    console.log(`  ${bars.length} bars`);

    if (dryRun || bars.length === 0) continue;

    const assetRow = await upsertAssetRow(symbol);
    const result = await prisma.dailyBar.createMany({
      data: bars.map((b) => ({
        assetId: assetRow.id,
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      })),
      skipDuplicates: true,
    });
    console.log(`  inserted ${result.count} new rows (duplicates skipped)`);
  }

  console.log("\n=== Final row counts ===");
  for (const symbol of ASSETS) {
    const asset = await prisma.asset.findUnique({ where: { symbol } });
    if (!asset) {
      console.log(`  ${symbol}: (no asset row)`);
      continue;
    }
    const count = await prisma.dailyBar.count({ where: { assetId: asset.id } });
    console.log(`  ${symbol}: ${count} bars`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
