import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import fs from "node:fs/promises";
import path from "node:path";

dayjs.extend(utc);
import { fetchMacroDaily } from "../src/data/macro-loader.js";
import { fetchFundingDaily } from "../src/data/funding-loader.js";
import { computeLiveSignal } from "../src/live/signal-computer.js";
import type { DailyBar } from "../src/types/bar.js";
import type { FundingBar } from "../src/data/funding-loader.js";

interface CliArgs {
  asset: "BTC-USD" | "ETH-USD";
  rebalanceThreshold: number;
}

function parseArgs(): CliArgs {
  let asset: CliArgs["asset"] = "BTC-USD";
  let rebalanceThreshold = 0.1;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--asset=")) {
      const v = a.slice("--asset=".length);
      if (v === "BTC-USD" || v === "ETH-USD") asset = v;
      else throw new Error(`Unsupported asset: ${v}`);
    } else if (a.startsWith("--rebalance-threshold=")) {
      rebalanceThreshold = Number(a.slice("--rebalance-threshold=".length));
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return { asset, rebalanceThreshold };
}

async function mergeNewMacro(
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

async function mergeNewFunding(
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

async function main() {
  const { asset, rebalanceThreshold } = parseArgs();
  const prisma = new PrismaClient();
  try {
    // Today in UTC
    const now = dayjs().utc();
    const todayDateStr = now.format("YYYY-MM-DD");
    const today = new Date(`${todayDateStr}T00:00:00Z`);

    // Fetch recent data (last 30 days buffer) to keep DB fresh
    const bufferStart = now.subtract(30, "day").format("YYYY-MM-DD");
    const bufferEnd = now.format("YYYY-MM-DD");

    console.log(`\n=== Live Signal Run: ${todayDateStr} (${asset}) ===\n`);
    console.log(`Fetching recent DXY (${bufferStart} → ${bufferEnd})...`);
    const recentDxy = await fetchMacroDaily("DX-Y.NYB", bufferStart, bufferEnd);
    await mergeNewMacro(prisma, "DX-Y.NYB", recentDxy);

    const fundingSymbol = asset === "BTC-USD" ? "BTCUSDT" : "ETHUSDT";
    console.log(`Fetching recent funding (${fundingSymbol})...`);
    const recentFunding = await fetchFundingDaily(
      fundingSymbol, bufferStart, bufferEnd,
    );
    await mergeNewFunding(prisma, fundingSymbol, recentFunding);

    // Load full history from DB for percentile calc
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

    console.log(`DB loaded: DXY ${dxyBars.length} rows, funding ${fundingBars.length} rows`);

    const sig = computeLiveSignal({
      dxyBars, fundingBars, today,
      wDxy: 0.60, wFunding: 0.40,
      dxySmaPeriod: 200, fundingLookback: 365,
    });

    // Previous position from DB
    const prev = await prisma.livePositionLog.findFirst({
      where: { asset, date: { lt: today } },
      orderBy: { date: "desc" },
    });
    const previousPosition = prev?.targetPosition ?? null;
    const rebalanceNeeded =
      previousPosition === null ||
      Math.abs(sig.targetPosition - previousPosition) > rebalanceThreshold;

    // Persist
    await prisma.livePositionLog.upsert({
      where: { asset_date: { asset, date: today } },
      create: {
        asset, date: today,
        dxyValue: sig.dxyValue ?? 0,
        dxyScore: sig.dxyScore,
        fundingValue: sig.fundingValue ?? 0,
        fundingScore: sig.fundingScore,
        targetPosition: sig.targetPosition,
        previousPosition,
        rebalanceFlag: rebalanceNeeded,
        notes: `wDxy=${sig.wDxy}, wFunding=${sig.wFunding}`,
      },
      update: {
        dxyValue: sig.dxyValue ?? 0,
        dxyScore: sig.dxyScore,
        fundingValue: sig.fundingValue ?? 0,
        fundingScore: sig.fundingScore,
        targetPosition: sig.targetPosition,
        previousPosition,
        rebalanceFlag: rebalanceNeeded,
      },
    });

    // Write JSON report
    const outDir = "reports/live";
    await fs.mkdir(outDir, { recursive: true });
    const jsonPath = path.join(outDir, `${todayDateStr}-${asset}.json`);
    const payload = {
      date: todayDateStr,
      asset,
      dxy: {
        value: sig.dxyValue,
        sma200: sig.dxySma,
        score: sig.dxyScore,
      },
      funding: {
        symbol: fundingSymbol,
        value: sig.fundingValue,
        percentile365: sig.fundingPercentile,
        score: sig.fundingScore,
      },
      weights: { wDxy: sig.wDxy, wFunding: sig.wFunding },
      targetPosition: sig.targetPosition,
      previousPosition,
      rebalanceThreshold,
      rebalanceNeeded,
    };
    await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf-8");

    // Console output
    console.log(`\n=== Signal ===`);
    console.log(`DXY:     ${sig.dxyValue?.toFixed(2)} (SMA200: ${sig.dxySma?.toFixed(2)})  → score ${sig.dxyScore.toFixed(3)}`);
    console.log(`Funding: ${(sig.fundingValue ? sig.fundingValue * 100 : 0).toFixed(4)}%  (pct365: ${sig.fundingPercentile?.toFixed(3) ?? "N/A"})  → score ${sig.fundingScore.toFixed(3)}`);
    console.log(`Weights: DXY ${sig.wDxy} / Funding ${sig.wFunding}`);
    console.log(`\n=== Target Position ===`);
    console.log(`Today:  ${(sig.targetPosition * 100).toFixed(1)}% long ${asset}`);
    if (previousPosition !== null) {
      console.log(`Prev:   ${(previousPosition * 100).toFixed(1)}%`);
      console.log(`Delta:  ${((sig.targetPosition - previousPosition) * 100).toFixed(1)}pp`);
    } else {
      console.log(`Prev:   (none, first run)`);
    }
    console.log(`Rebalance: ${rebalanceNeeded ? "YES ★" : "NO"} (threshold ${rebalanceThreshold})`);
    console.log(`\nReport: ${jsonPath}`);

    if (rebalanceNeeded) {
      console.log(`\n⚠️  REBALANCE ALERT: position change > ${rebalanceThreshold}`);
      console.log(`   Action: manually execute rebalance on exchange (Phase 1, no auto-execution)`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
