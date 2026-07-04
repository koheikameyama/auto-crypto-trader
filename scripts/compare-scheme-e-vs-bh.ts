/**
 * Scheme E vs Buy & Hold — full-period single-run comparison.
 *
 * 目的: walk-forward report が "Beats BH" を Sharpe ベースでしか記録していないため、
 *        総リターン (total return) でも BH と比較して記録する。
 *
 * 注意: これは WF ではなく full-period の単一バックテスト。
 *        params は live 運用 (signal-computer) に合わせて固定:
 *        wDxy=0.60, wFunding=0.40, dxySmaPeriod=200, fundingLookback=365, threshold=0.10
 */
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { loadBars } from "../src/backtest/runner-helpers.js";
import {
  runWeightedBacktest,
  type WeightedParams,
} from "../src/backtest/weighted-ensemble-engine.js";
import { buyAndHold } from "../src/lib/buy-and-hold.js";
import type { OnchainBar } from "../src/data/onchain-loader.js";
import type { FundingBar } from "../src/data/funding-loader.js";
import type { DailyBar } from "../src/types/bar.js";
import type { AssetSymbol } from "../src/types/asset.js";

async function loadMacroBars(prisma: PrismaClient, ticker: string, s: Date, e: Date): Promise<DailyBar[]> {
  const rows = await prisma.macroBar.findMany({
    where: { ticker, date: { gte: s, lte: e } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({ date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
}

async function loadFundingBars(prisma: PrismaClient, symbol: string, s: Date, e: Date): Promise<FundingBar[]> {
  const rows = await prisma.fundingRate.findMany({
    where: { symbol, date: { gte: s, lte: e } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({ date: r.date, avgRate: r.avgRate, count: r.count }));
}

const PARAMS: WeightedParams = {
  nvtLookback: 0, aaLookback: 0, percentileWindow: 365,
  dxySmaPeriod: 200, vixThreshold: 30, fundingLookback: 365, tnxLookback: 365,
  rebalanceThreshold: 0.10,
  wOnchain: 0, wDxy: 0.60, wVix: 0, wFunding: 0.40, wTnx: 0,
};

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const mult = (x: number) => `${(1 + x).toFixed(2)}×`;

async function compareAsset(
  prisma: PrismaClient,
  asset: AssetSymbol,
  fundingSymbol: string,
  startStr: string,
) {
  const start = dayjs(startStr);
  const end = dayjs();
  const bars = await loadBars(prisma, asset, start.toDate(), end.toDate());
  const dxy = await loadMacroBars(prisma, "DX-Y.NYB", start.toDate(), end.toDate());
  const vix = await loadMacroBars(prisma, "^VIX", start.toDate(), end.toDate());
  const tnx = await loadMacroBars(prisma, "^TNX", start.toDate(), end.toDate());
  const funding = await loadFundingBars(prisma, fundingSymbol, start.toDate(), end.toDate());

  const res = runWeightedBacktest({
    asset, btcBars: bars, onchainBars: [], dxyBars: dxy, vixBars: vix,
    fundingBars: funding, tnxBars: tnx, params: PARAMS, initialCapital: 10_000,
  });
  const bh = buyAndHold(bars);
  if (!bh) throw new Error("BH failed");

  const first = bars[0].date, last = bars[bars.length - 1].date;
  const years = (last.getTime() - first.getTime()) / (365.25 * 86400_000);

  console.log(`\n========== ${asset} ==========`);
  console.log(`Period: ${dayjs(first).format("YYYY-MM-DD")} → ${dayjs(last).format("YYYY-MM-DD")} (${years.toFixed(1)}y, ${bars.length} bars)`);
  console.log(`\n  指標                Scheme E        Buy & Hold`);
  console.log(`  ------------------  --------------  --------------`);
  console.log(`  総リターン          ${mult(res.totalReturn).padEnd(14)}  ${mult(bh.totalReturn)}`);
  console.log(`  総リターン(%)       ${pct(res.totalReturn).padEnd(14)}  ${pct(bh.totalReturn)}`);
  console.log(`  Sharpe              ${res.sharpe.toFixed(3).padEnd(14)}  ${bh.sharpe.toFixed(3)}`);
  console.log(`  Max DD              ${pct(res.maxDrawdown).padEnd(14)}  ${pct(bh.maxDrawdown)}`);
  console.log(`  MAR                 ${res.mar.toFixed(2).padEnd(14)}  ${bh.mar.toFixed(2)}`);
  console.log(`  rebalance 回数      ${res.tradeCount}`);

  const retRatio = (1 + res.totalReturn) / (1 + bh.totalReturn);
  console.log(`\n  → 生リターンは BH の ${(retRatio * 100).toFixed(0)}% (${retRatio >= 1 ? "上回る" : "下回る"})`);
  console.log(`  → DD は BH の ${(res.maxDrawdown / bh.maxDrawdown * 100).toFixed(0)}% に抑制`);
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await compareAsset(prisma, "BTC-USD", "BTCUSDT", "2019-10-01");
    await compareAsset(prisma, "ETH-USD", "ETHUSDT", "2019-11-01");
  } finally {
    await prisma.$disconnect();
  }
}

main();
