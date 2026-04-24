import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import fs from "node:fs/promises";
import path from "node:path";
import { fetchMacroDaily } from "../src/data/macro-loader.js";
import { fetchFundingDaily } from "../src/data/funding-loader.js";
import { fetchCryptoDaily } from "../src/data/price-loader.js";
import { computeLiveSignal } from "../src/live/signal-computer.js";
import { simulateDailyRebalance } from "../src/live/portfolio-simulator.js";
import type { DailyBar } from "../src/types/bar.js";
import type { FundingBar } from "../src/data/funding-loader.js";

dayjs.extend(utc);

interface CliArgs {
  asset: "BTC-USD" | "ETH-USD";
  rebalanceThreshold: number;
  initialCapital: number;
}

function parseArgs(): CliArgs {
  let asset: CliArgs["asset"] = "BTC-USD";
  let rebalanceThreshold = 0.1;
  let initialCapital = 10_000;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--asset=")) {
      const v = a.slice("--asset=".length);
      if (v === "BTC-USD" || v === "ETH-USD") asset = v;
      else throw new Error(`Unsupported asset: ${v}`);
    } else if (a.startsWith("--rebalance-threshold=")) {
      rebalanceThreshold = Number(a.slice("--rebalance-threshold=".length));
    } else if (a.startsWith("--initial-capital=")) {
      initialCapital = Number(a.slice("--initial-capital=".length));
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return { asset, rebalanceThreshold, initialCapital };
}

async function mergeMacro(
  prisma: PrismaClient,
  ticker: string,
  recent: DailyBar[],
): Promise<void> {
  if (recent.length === 0) return;
  await prisma.macroBar.createMany({
    data: recent.map((b) => ({
      ticker, date: b.date,
      open: b.open, high: b.high, low: b.low, close: b.close,
      volume: b.volume,
    })),
    skipDuplicates: true,
  });
}

async function mergeFunding(
  prisma: PrismaClient,
  symbol: string,
  recent: FundingBar[],
): Promise<void> {
  if (recent.length === 0) return;
  await prisma.fundingRate.createMany({
    data: recent.map((b) => ({
      symbol, date: b.date, avgRate: b.avgRate, count: b.count,
    })),
    skipDuplicates: true,
  });
}

async function mergeDailyBars(
  prisma: PrismaClient,
  assetSymbol: "BTC-USD" | "ETH-USD",
  recent: DailyBar[],
): Promise<void> {
  if (recent.length === 0) return;
  const a = await prisma.asset.findUnique({ where: { symbol: assetSymbol } });
  if (!a) return;
  await prisma.dailyBar.createMany({
    data: recent.map((b) => ({
      assetId: a.id, date: b.date,
      open: b.open, high: b.high, low: b.low, close: b.close,
      volume: b.volume,
    })),
    skipDuplicates: true,
  });
}

async function main() {
  const { asset, rebalanceThreshold, initialCapital } = parseArgs();
  const prisma = new PrismaClient();
  try {
    const now = dayjs().utc();
    const todayDateStr = now.format("YYYY-MM-DD");
    const today = new Date(`${todayDateStr}T00:00:00Z`);

    const bufferStart = now.subtract(30, "day").format("YYYY-MM-DD");
    const bufferEnd = now.format("YYYY-MM-DD");

    console.log(`\n=== Live Rebalance Run: ${todayDateStr} (${asset}) ===\n`);

    // Fetch recent macro/funding/asset price (best-effort; yfinance occasionally 451s
    // from cloud IPs — fall back to DB-cached history)
    console.log(`Fetching recent DXY + funding + ${asset} price...`);
    let recentDxy: DailyBar[] = [];
    try {
      recentDxy = await fetchMacroDaily("DX-Y.NYB", bufferStart, bufferEnd);
      await mergeMacro(prisma, "DX-Y.NYB", recentDxy);
    } catch (e) {
      console.warn(`DXY fetch failed, using cached: ${(e as Error).message}`);
    }

    const fundingSymbol = asset === "BTC-USD" ? "BTCUSDT" : "ETHUSDT";
    let recentFunding: FundingBar[] = [];
    try {
      recentFunding = await fetchFundingDaily(fundingSymbol, bufferStart, bufferEnd);
      await mergeFunding(prisma, fundingSymbol, recentFunding);
    } catch (e) {
      console.warn(`Funding fetch failed, using cached: ${(e as Error).message}`);
    }

    let recentPrice: DailyBar[] = [];
    try {
      recentPrice = await fetchCryptoDaily(asset, bufferStart, bufferEnd);
      await mergeDailyBars(prisma, asset, recentPrice);
    } catch (e) {
      console.warn(`${asset} price fetch failed, using cached: ${(e as Error).message}`);
    }

    // Load histories
    const lookbackStart = now.subtract(2, "year").toDate();
    const dxyRows = await prisma.macroBar.findMany({
      where: { ticker: "DX-Y.NYB", date: { gte: lookbackStart, lte: today } },
      orderBy: { date: "asc" },
    });
    const dxyBars: DailyBar[] = dxyRows.map((r) => ({
      date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
    }));

    const fundRows = await prisma.fundingRate.findMany({
      where: { symbol: fundingSymbol, date: { gte: lookbackStart, lte: today } },
      orderBy: { date: "asc" },
    });
    const fundingBars: FundingBar[] = fundRows.map((r) => ({
      date: r.date, avgRate: r.avgRate, count: r.count,
    }));

    // Latest asset price: prefer fresh fetch, fall back to DB
    let price = recentPrice[recentPrice.length - 1]?.close ?? 0;
    if (!(price > 0)) {
      const assetRow = await prisma.asset.findUnique({ where: { symbol: asset } });
      if (assetRow) {
        const cachedBar = await prisma.dailyBar.findFirst({
          where: { assetId: assetRow.id },
          orderBy: { date: "desc" },
        });
        if (cachedBar && cachedBar.close > 0) {
          price = cachedBar.close;
          console.warn(`Using cached ${asset} price from ${cachedBar.date.toISOString().slice(0, 10)}: $${price.toFixed(2)}`);
        }
      }
    }
    if (!(price > 0)) {
      throw new Error(`No valid ${asset} price available (fetch + DB both empty)`);
    }

    console.log(`Data: DXY ${dxyBars.length} rows, funding ${fundingBars.length} rows, ${asset} price $${price.toFixed(2)}`);

    // Compute target signal
    const sig = computeLiveSignal({
      dxyBars, fundingBars, today,
      wDxy: 0.60, wFunding: 0.40,
      dxySmaPeriod: 200, fundingLookback: 365,
    });

    // Load previous virtual state
    const prev = await prisma.virtualPortfolioState.findFirst({
      where: { asset, date: { lt: today } },
      orderBy: { date: "desc" },
    });

    // Run simulator
    const result = simulateDailyRebalance({
      asset,
      price,
      targetPosition: sig.targetPosition,
      prev: prev ? { cashUsd: prev.cashUsd, units: prev.units } : null,
      initialCapital,
      rebalanceThreshold,
    });

    // Cumulative metrics
    const initialCap = prev === null ? initialCapital : prev.equityUsd / (1 + (prev.cumulativeReturn));
    // Actually: reconstruct initialCapital from the first row if prev exists
    let actualInitialCapital = initialCapital;
    if (prev !== null) {
      // Find very first state for this asset
      const first = await prisma.virtualPortfolioState.findFirst({
        where: { asset },
        orderBy: { date: "asc" },
      });
      if (first) {
        // first.equityUsd at t=0 was initial (could include day-1 rebalance fee though)
        // Better: infer from first row's (equityUsd + feeUsd) ≈ initial pre-fee equity
        actualInitialCapital = first.equityUsd + first.feeUsd;
        // Slight approximation but stable enough
      }
    }
    const cumulativeReturn = (result.equityUsd - actualInitialCapital) / actualInitialCapital;
    const cumulativeFee = (prev?.cumulativeFee ?? 0) + result.feeUsd;

    // Save state
    await prisma.virtualPortfolioState.upsert({
      where: { asset_date: { asset, date: today } },
      create: {
        asset, date: today, price,
        targetPosition: sig.targetPosition,
        actualPosition: result.actualPosition,
        cashUsd: result.cashUsd,
        units: result.units,
        equityUsd: result.equityUsd,
        rebalancedToday: result.rebalancedToday,
        rebalanceDelta: result.rebalanceDelta,
        feeUsd: result.feeUsd,
        cumulativeReturn,
        cumulativeFee,
      },
      update: {
        price,
        targetPosition: sig.targetPosition,
        actualPosition: result.actualPosition,
        cashUsd: result.cashUsd,
        units: result.units,
        equityUsd: result.equityUsd,
        rebalancedToday: result.rebalancedToday,
        rebalanceDelta: result.rebalanceDelta,
        feeUsd: result.feeUsd,
        cumulativeReturn,
        cumulativeFee,
      },
    });

    // Console output
    console.log(`\n=== Signal ===`);
    console.log(`DXY: ${sig.dxyValue?.toFixed(2)} (score ${sig.dxyScore.toFixed(3)})`);
    console.log(`Funding: ${((sig.fundingValue ?? 0) * 100).toFixed(4)}% (pct ${sig.fundingPercentile?.toFixed(3) ?? "N/A"}, score ${sig.fundingScore.toFixed(3)})`);
    console.log(`Target: ${(sig.targetPosition * 100).toFixed(1)}% long ${asset}`);

    console.log(`\n=== Virtual Portfolio ===`);
    console.log(`Price:     $${price.toFixed(2)}`);
    if (prev === null) {
      console.log(`*** FIRST RUN: starting with $${initialCapital.toFixed(2)} cash ***`);
    }
    console.log(`Cash:      $${result.cashUsd.toFixed(2)}`);
    console.log(`Holdings:  ${result.units.toFixed(6)} ${asset.split("-")[0]} ≈ $${(result.units * price).toFixed(2)}`);
    console.log(`Equity:    $${result.equityUsd.toFixed(2)}`);
    console.log(`Actual %:  ${(result.actualPosition * 100).toFixed(1)}%`);
    console.log(`Rebalanced: ${result.rebalancedToday ? "YES ★" : "NO"}`);
    if (result.rebalancedToday) {
      console.log(`  Δunits: ${result.rebalanceDelta > 0 ? "+" : ""}${result.rebalanceDelta.toFixed(6)}`);
      console.log(`  Fee:    $${result.feeUsd.toFixed(2)}`);
    }
    console.log(`\n=== Cumulative ===`);
    console.log(`Return:    ${cumulativeReturn >= 0 ? "+" : ""}${(cumulativeReturn * 100).toFixed(2)}%`);
    console.log(`Total fee: $${cumulativeFee.toFixed(2)}`);

    // JSON report
    const outDir = "reports/live";
    await fs.mkdir(outDir, { recursive: true });
    const jsonPath = path.join(outDir, `${todayDateStr}-${asset}-portfolio.json`);
    const payload = {
      date: todayDateStr,
      asset,
      price,
      signal: {
        dxyValue: sig.dxyValue,
        dxyScore: sig.dxyScore,
        fundingValue: sig.fundingValue,
        fundingScore: sig.fundingScore,
        targetPosition: sig.targetPosition,
      },
      portfolio: {
        cashUsd: result.cashUsd,
        units: result.units,
        equityUsd: result.equityUsd,
        actualPosition: result.actualPosition,
        rebalancedToday: result.rebalancedToday,
        rebalanceDelta: result.rebalanceDelta,
        feeUsd: result.feeUsd,
      },
      cumulative: {
        return: cumulativeReturn,
        fee: cumulativeFee,
      },
      config: {
        wDxy: sig.wDxy,
        wFunding: sig.wFunding,
        rebalanceThreshold,
        initialCapital,
      },
    };
    await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf-8");
    console.log(`\nReport: ${jsonPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
