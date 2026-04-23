import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import type { DailyBar } from "../types/bar.js";
import type { AssetSymbol } from "../types/asset.js";
import type { Strategy } from "../types/strategy.js";
import { writeBacktestReport } from "../reports/markdown-writer.js";
import { runBacktest, type BacktestResult } from "./engine.js";

export interface RunAndPersistArgs<P> {
  prisma: PrismaClient;
  strategy: Strategy<P>;
  asset: AssetSymbol;
  params: P;
  startDate: Date;
  endDate: Date;
  initialCapital: number;
  riskRatio: number;
  annualFundingRate?: number;
  reportDir?: string;
}

export interface RunAndPersistResult {
  backtestRunId: string;
  reportPath: string;
  result: BacktestResult;
}

function safeKpi(n: number, max = 999): number {
  if (Number.isNaN(n)) return 0;
  if (n === Infinity) return max;
  if (n === -Infinity) return -max;
  return n;
}

/**
 * Load daily bars for an asset within the given date range, ordered by date ASC.
 * Throws if the Asset row does not exist.
 */
export async function loadBars(
  prisma: PrismaClient,
  asset: AssetSymbol,
  startDate: Date,
  endDate: Date,
): Promise<DailyBar[]> {
  const assetRow = await prisma.asset.findUnique({ where: { symbol: asset } });
  if (!assetRow) {
    throw new Error(`Asset not found in DB: ${asset}`);
  }

  const rows = await prisma.dailyBar.findMany({
    where: {
      assetId: assetRow.id,
      date: { gte: startDate, lte: endDate },
    },
    orderBy: { date: "asc" },
  });

  return rows.map((r) => ({
    date: r.date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume ?? null,
  }));
}

function formatKpiLine(result: BacktestResult): string {
  const sharpe = Number.isFinite(result.sharpe) ? result.sharpe.toFixed(3) : "∞";
  const mar = Number.isFinite(result.mar) ? result.mar.toFixed(3) : "∞";
  const pf = Number.isFinite(result.profitFactor)
    ? result.profitFactor.toFixed(3)
    : "∞";
  const dd = (result.maxDrawdown * 100).toFixed(2);
  const wr = (result.winRate * 100).toFixed(1);
  return `Sharpe: ${sharpe} | MAR: ${mar} | PF: ${pf} | DD: ${dd}% | Trades: ${result.tradeCount} | WinRate: ${wr}%`;
}

/**
 * Run backtest for one strategy/asset combination and persist results.
 *
 * Side effects (in order):
 *  1. Loads bars from DB.
 *  2. Executes `runBacktest` (pure).
 *  3. Creates a `BacktestRun` row with KPI summary.
 *  4. Bulk-inserts all `Trade` rows linked to that run.
 *  5. Writes a Markdown report to disk.
 *  6. Updates the `BacktestRun` with the report path.
 */
export async function runAndPersist<P>(
  args: RunAndPersistArgs<P>,
): Promise<RunAndPersistResult> {
  const {
    prisma,
    strategy,
    asset,
    params,
    startDate,
    endDate,
    initialCapital,
    riskRatio,
    annualFundingRate,
    reportDir,
  } = args;

  const bars = await loadBars(prisma, asset, startDate, endDate);
  if (bars.length === 0) {
    throw new Error(
      `No bars found for ${asset} between ${dayjs(startDate).format("YYYY-MM-DD")} and ${dayjs(endDate).format("YYYY-MM-DD")}`,
    );
  }

  const result = runBacktest({
    bars,
    asset,
    strategy,
    params,
    initialCapital,
    riskRatio,
    annualFundingRate,
  });

  const run = await prisma.backtestRun.create({
    data: {
      strategy: strategy.name,
      assetSymbol: asset,
      startDate,
      endDate,
      initialCapital,
      params: params as object,
      totalReturn: safeKpi(result.totalReturn),
      sharpe: safeKpi(result.sharpe),
      mar: safeKpi(result.mar),
      profitFactor: safeKpi(result.profitFactor),
      maxDrawdown: safeKpi(result.maxDrawdown),
      winRate: safeKpi(result.winRate),
      tradeCount: result.tradeCount,
      expectancy: safeKpi(result.expectancy),
    },
  });

  const assetRow = await prisma.asset.findUnique({ where: { symbol: asset } });
  if (!assetRow) {
    throw new Error(`Asset row disappeared for ${asset}`);
  }

  if (result.trades.length > 0) {
    await prisma.trade.createMany({
      data: result.trades.map((t) => ({
        backtestRunId: run.id,
        assetId: assetRow.id,
        strategy: strategy.name,
        side: t.side,
        entryDate: t.entryDate,
        entryPrice: t.entryPrice,
        exitDate: t.exitDate,
        exitPrice: t.exitPrice,
        exitReason: t.exitReason,
        sizeUnits: t.sizeUnits,
        pnlUsd: t.pnlUsd,
        holdingDays: t.holdingDays,
      })),
    });
  }

  const reportPath = await writeBacktestReport({
    strategy: strategy.name,
    asset,
    result,
    startDate,
    endDate,
    params: params as Record<string, unknown>,
    initialCapital,
    outputDir: reportDir,
  });

  await prisma.backtestRun.update({
    where: { id: run.id },
    data: { reportPath },
  });

  const startStr = dayjs(startDate).format("YYYY-MM-DD");
  const endStr = dayjs(endDate).format("YYYY-MM-DD");
  console.log(`\n=== ${strategy.name} / ${asset} ===`);
  console.log(`Period: ${startStr} – ${endStr}`);
  console.log(formatKpiLine(result));
  console.log(`Report: ${reportPath}`);

  return {
    backtestRunId: run.id,
    reportPath,
    result,
  };
}
