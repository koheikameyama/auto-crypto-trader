import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { fetchOnchainDaily } from "../src/data/onchain-loader.js";
import { getAssetConfig } from "../src/data/asset-config.js";

const prisma = new PrismaClient();

interface CliArgs {
  years: number;
  dryRun: boolean;
}

function parseArgs(): CliArgs {
  let years = 10;
  let dryRun = false;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--years=")) {
      years = Number(a.slice("--years=".length));
    } else if (a === "--dry-run") {
      dryRun = true;
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!Number.isFinite(years) || years <= 0) {
    throw new Error(`Invalid years: ${years}`);
  }
  return { years, dryRun };
}

async function upsertAssetRow() {
  const cfg = getAssetConfig("BTC-USD");
  return prisma.asset.upsert({
    where: { symbol: "BTC-USD" },
    create: {
      symbol: "BTC-USD",
      yfinanceTicker: cfg.yfinanceTicker,
      feeRate: cfg.feeRate,
    },
    update: {},
  });
}

async function main() {
  const { years, dryRun } = parseArgs();
  const end = dayjs();
  const start = end.subtract(years, "year");
  const startIso = start.format("YYYY-MM-DD");
  const endIso = end.format("YYYY-MM-DD");

  console.log(
    `Onchain backfill range: ${startIso} → ${endIso} (${years}y), BTC only`,
  );
  if (dryRun) console.log("(dry-run)");

  const bars = await fetchOnchainDaily("BTC-USD", startIso, endIso);
  console.log(`Fetched ${bars.length} bars`);

  if (dryRun || bars.length === 0) return;

  const assetRow = await upsertAssetRow();
  const result = await prisma.onchainMetric.createMany({
    data: bars.map((b) => ({
      assetId: assetRow.id,
      date: b.date,
      priceUsd: b.priceUsd,
      capMrktUsd: b.capMrktUsd,
      txCnt: b.txCnt,
      adrActCnt: b.adrActCnt,
    })),
    skipDuplicates: true,
  });
  console.log(`Inserted ${result.count} rows (duplicates skipped)`);

  const total = await prisma.onchainMetric.count({
    where: { assetId: assetRow.id },
  });
  console.log(`Total OnchainMetric rows for BTC-USD: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
