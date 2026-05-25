/**
 * Daily actual execution entry point (Phase 2 GMO Coin spot).
 *
 * Idempotent by (asset, date) unique. Re-running the same day will UPSERT
 * the latest state; subsequent runs re-evaluate target vs current balance,
 * but rebalance only triggers when outside threshold, so a no-op re-run is
 * safe.
 *
 * Usage:
 *   npx tsx scripts/live-execute.ts --asset=BTC
 *   npx tsx scripts/live-execute.ts --asset=ETH --dry-run
 */
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import fs from "node:fs/promises";
import path from "node:path";
import { GmoApiError, GmoClient } from "../src/live/gmo-client.js";
import {
  executeRebalance,
  recordStateUnchanged,
  type ActualAsset,
  type ExecutionAdapterOutput,
} from "../src/live/execution-adapter.js";
import { checkAlerts } from "../src/live/kill-switch.js";
import { computeLiveSignal } from "../src/live/signal-computer.js";
import { fetchMacroDaily } from "../src/data/macro-loader.js";
import { fetchFundingDaily } from "../src/data/funding-loader.js";
import type { DailyBar } from "../src/types/bar.js";
import type { FundingBar } from "../src/data/funding-loader.js";

dayjs.extend(utc);

interface CliArgs {
  asset: ActualAsset;
  dryRun: boolean;
  rebalanceThreshold: number;
  makerLimitWaitSec: number;
}

function parseArgs(): CliArgs {
  let asset: ActualAsset = "BTC";
  let dryRun = false;
  let rebalanceThreshold = 0.1;
  let makerLimitWaitSec = 300;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--asset=")) {
      const v = a.slice("--asset=".length);
      if (v === "BTC" || v === "ETH") asset = v;
      else throw new Error(`Unsupported asset: ${v}`);
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a.startsWith("--rebalance-threshold=")) {
      rebalanceThreshold = Number(a.slice("--rebalance-threshold=".length));
    } else if (a.startsWith("--maker-wait-sec=")) {
      makerLimitWaitSec = Number(a.slice("--maker-wait-sec=".length));
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return { asset, dryRun, rebalanceThreshold, makerLimitWaitSec };
}

async function main(): Promise<void> {
  const { asset, dryRun, rebalanceThreshold, makerLimitWaitSec } = parseArgs();
  const apiKey = process.env.GMO_API_KEY;
  const apiSecret = process.env.GMO_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error("GMO_API_KEY and GMO_API_SECRET must be set in .env");
  }

  const prisma = new PrismaClient();
  const client = new GmoClient({ apiKey, apiSecret });

  try {
    const now = dayjs().utc();
    const todayDateStr = now.format("YYYY-MM-DD");
    const today = new Date(`${todayDateStr}T00:00:00Z`);

    console.log(
      `\n=== Live Execute: ${todayDateStr} (${asset}${dryRun ? ", DRY-RUN" : ""}) ===\n`,
    );

    const sig = await computeSignalForAsset(prisma, asset, now);
    console.log(
      `Signal: DXY score ${sig.dxyScore.toFixed(3)}, funding score ${sig.fundingScore.toFixed(3)}, target ${(sig.targetPosition * 100).toFixed(1)}% long`,
    );

    let result: ExecutionAdapterOutput;
    try {
      result = await executeRebalance({
        asset,
        targetPosition: sig.targetPosition,
        client,
        prisma,
        today,
        rebalanceThreshold,
        makerLimitWaitSec,
        dryRun,
      });
    } catch (err) {
      if (isTransientGmoOutage(err)) {
        console.log(
          `\n⚠️  GMO transient outage detected (${(err as Error).message}). Writing carry row.`,
        );
        result = await recordStateUnchanged(
          prisma,
          asset,
          today,
          sig.targetPosition,
          "gmo_maintenance",
        );
      } else {
        throw err;
      }
    }

    console.log();
    if (result.skipped) {
      console.log(`Skipped: ${result.skipReason ?? "below threshold"}`);
    } else {
      console.log(`=== Actual Portfolio ===`);
      console.log(`Price (ref): ¥${result.price.toFixed(0)}`);
      console.log(`Cash:        ¥${result.cashJpy.toFixed(0)}`);
      console.log(
        `Holdings:    ${result.units.toFixed(6)} ${asset} ≈ ¥${(result.units * result.price).toFixed(0)}`,
      );
      console.log(`Equity:      ¥${result.equityJpy.toFixed(0)}`);
      console.log(`Actual %:    ${(result.actualPosition * 100).toFixed(1)}%`);
      console.log(`Rebalanced:  ${result.rebalancedToday ? "YES ★" : "NO"}`);
      if (result.rebalancedToday) {
        console.log(
          `  Δunits:    ${result.rebalanceDelta > 0 ? "+" : ""}${result.rebalanceDelta.toFixed(6)}`,
        );
        console.log(`  Fee:       ¥${result.feeJpy.toFixed(2)}`);
        console.log(`  Slippage:  ${result.slippageBps.toFixed(1)}bps`);
      }
      console.log(`\n=== Cumulative ===`);
      console.log(
        `Return:      ${result.cumulativeReturn >= 0 ? "+" : ""}${(result.cumulativeReturn * 100).toFixed(2)}%`,
      );
      console.log(`Total fee:   ¥${result.cumulativeFeeJpy.toFixed(2)}`);
    }

    const virtualToday = await prisma.virtualPortfolioState.findFirst({
      where: { asset: `${asset}-USD`, date: today },
    });
    const alerts = await checkAlerts(
      prisma,
      asset,
      {
        slippageBps: result.slippageBps,
        cumulativeReturn: result.cumulativeReturn,
      },
      virtualToday
        ? { cumulativeReturn: virtualToday.cumulativeReturn }
        : null,
    );
    if (alerts.length > 0) {
      console.log(`\n=== Alerts ===`);
      for (const a of alerts) {
        console.log(`[${a.severity}] ${a.code}: ${a.message}`);
      }
    }

    const outDir = "reports/live";
    await fs.mkdir(outDir, { recursive: true });
    const jsonPath = path.join(outDir, `${todayDateStr}-${asset}-actual.json`);
    const payload = {
      date: todayDateStr,
      asset,
      dryRun,
      signal: {
        dxyValue: sig.dxyValue,
        dxyScore: sig.dxyScore,
        fundingValue: sig.fundingValue,
        fundingScore: sig.fundingScore,
        targetPosition: sig.targetPosition,
      },
      portfolio: {
        cashJpy: result.cashJpy,
        units: result.units,
        equityJpy: result.equityJpy,
        actualPosition: result.actualPosition,
        rebalancedToday: result.rebalancedToday,
        rebalanceDelta: result.rebalanceDelta,
        feeJpy: result.feeJpy,
        slippageBps: result.slippageBps,
      },
      cumulative: {
        return: result.cumulativeReturn,
        feeJpy: result.cumulativeFeeJpy,
      },
      skipped: result.skipped,
      skipReason: result.skipReason,
      alerts,
      config: {
        wDxy: sig.wDxy,
        wFunding: sig.wFunding,
        rebalanceThreshold,
        makerLimitWaitSec,
      },
    };
    await fs.writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf-8");
    console.log(`\nReport: ${jsonPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * GMO Coin returns ERR-5106 with message "MAINTENANCE" during scheduled
 * maintenance windows (incl. ~Saturday 10:05 JST observed 2026-05-16 / 05-23).
 * Treat these as transient: skip the day, write a carry row, don't fail the
 * workflow. Any other error still throws.
 */
function isTransientGmoOutage(err: unknown): boolean {
  if (!(err instanceof GmoApiError)) return false;
  const haystack = [
    err.message,
    ...(err.messages?.map((m) => m.message_string) ?? []),
  ]
    .join(" ")
    .toUpperCase();
  return haystack.includes("MAINTENANCE");
}

async function computeSignalForAsset(
  prisma: PrismaClient,
  asset: ActualAsset,
  now: dayjs.Dayjs,
) {
  const todayDateStr = now.format("YYYY-MM-DD");
  const today = new Date(`${todayDateStr}T00:00:00Z`);
  const bufferStart = now.subtract(30, "day").format("YYYY-MM-DD");
  const bufferEnd = now.format("YYYY-MM-DD");

  // Best-effort: fall back to DB-cached bars if a source 451s or otherwise fails.
  try {
    const recentDxy = await fetchMacroDaily("DX-Y.NYB", bufferStart, bufferEnd);
    if (recentDxy.length > 0) {
      await prisma.macroBar.createMany({
        data: recentDxy.map((b) => ({
          ticker: "DX-Y.NYB",
          date: b.date,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
          volume: b.volume,
        })),
        skipDuplicates: true,
      });
    }
  } catch (e) {
    console.warn(`DXY fetch failed, using cached: ${(e as Error).message}`);
  }

  const fundingSymbol = asset === "BTC" ? "BTCUSDT" : "ETHUSDT";
  try {
    const recentFunding = await fetchFundingDaily(
      fundingSymbol,
      bufferStart,
      bufferEnd,
    );
    if (recentFunding.length > 0) {
      await prisma.fundingRate.createMany({
        data: recentFunding.map((b) => ({
          symbol: fundingSymbol,
          date: b.date,
          avgRate: b.avgRate,
          count: b.count,
        })),
        skipDuplicates: true,
      });
    }
  } catch (e) {
    console.warn(`Funding fetch failed, using cached: ${(e as Error).message}`);
  }

  const lookbackStart = now.subtract(2, "year").toDate();
  const dxyRows = await prisma.macroBar.findMany({
    where: { ticker: "DX-Y.NYB", date: { gte: lookbackStart, lte: today } },
    orderBy: { date: "asc" },
  });
  const dxyBars: DailyBar[] = dxyRows.map((r) => ({
    date: r.date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
  const fundRows = await prisma.fundingRate.findMany({
    where: { symbol: fundingSymbol, date: { gte: lookbackStart, lte: today } },
    orderBy: { date: "asc" },
  });
  const fundingBars: FundingBar[] = fundRows.map((r) => ({
    date: r.date,
    avgRate: r.avgRate,
    count: r.count,
  }));

  return computeLiveSignal({
    dxyBars,
    fundingBars,
    today,
    wDxy: 0.6,
    wFunding: 0.4,
    dxySmaPeriod: 200,
    fundingLookback: 365,
  });
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
