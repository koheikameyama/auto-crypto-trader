/**
 * 固定パラメータ WF: Scheme E vs BH を「同一方法」で公平比較。
 *
 * 背景: walk-forward-weighted-ensemble.ts は
 *   - Scheme E: 窓ごとに hyperGrid を in-sample 再最適化 → OOS Sharpe を窓平均 (1.096)
 *   - BH:       full-period の単一 Sharpe (0.871)
 *   という apples-to-oranges 比較で "Beats BH" を主張していた。
 *
 * 本スクリプトは 2 つの歪みを除去:
 *   (1) 窓ごとハイパラ再最適化を撤廃 → live と同じ固定パラメータ
 *       (dxySmaPeriod=200, threshold=0.10, wDxy=0.60, wFunding=0.40)
 *   (2) BH も Scheme E と同じ OOS 窓で Sharpe を測り、窓平均で比較
 *
 * これで「Scheme E は本当に BH を上回るのか」を同一土俵で判定する。
 */
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { loadBars } from "../src/backtest/runner-helpers.js";
import { runWeightedBacktest, type WeightedParams } from "../src/backtest/weighted-ensemble-engine.js";
import { buyAndHold } from "../src/lib/buy-and-hold.js";
import type { FundingBar } from "../src/data/funding-loader.js";
import type { DailyBar } from "../src/types/bar.js";
import type { AssetSymbol } from "../src/types/asset.js";

const DAY_MS = 86400_000;

async function loadMacro(prisma: PrismaClient, ticker: string, s: Date, e: Date): Promise<DailyBar[]> {
  const rows = await prisma.macroBar.findMany({ where: { ticker, date: { gte: s, lte: e } }, orderBy: { date: "asc" } });
  return rows.map((r) => ({ date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume }));
}
async function loadFunding(prisma: PrismaClient, symbol: string, s: Date, e: Date): Promise<FundingBar[]> {
  const rows = await prisma.fundingRate.findMany({ where: { symbol, date: { gte: s, lte: e } }, orderBy: { date: "asc" } });
  return rows.map((r) => ({ date: r.date, avgRate: r.avgRate, count: r.count }));
}
const slice = <T extends { date: Date }>(b: T[], s: Date, e: Date) => b.filter((x) => x.date >= s && x.date <= e);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const safe = (n: number) => (Number.isFinite(n) ? n : 0);

const PARAMS: WeightedParams = {
  nvtLookback: 0, aaLookback: 0, percentileWindow: 365,
  dxySmaPeriod: 200, vixThreshold: 30, fundingLookback: 365, tnxLookback: 365,
  rebalanceThreshold: 0.10, wOnchain: 0, wDxy: 0.60, wVix: 0, wFunding: 0.40, wTnx: 0,
};

async function runAsset(prisma: PrismaClient, asset: AssetSymbol, fundingSym: string, startStr: string) {
  const start = dayjs(startStr), end = dayjs();
  const bars = await loadBars(prisma, asset, start.toDate(), end.toDate());
  const dxy = await loadMacro(prisma, "DX-Y.NYB", start.toDate(), end.toDate());
  const vix = await loadMacro(prisma, "^VIX", start.toDate(), end.toDate());
  const tnx = await loadMacro(prisma, "^TNX", start.toDate(), end.toDate());
  const funding = await loadFunding(prisma, fundingSym, start.toDate(), end.toDate());

  const isDays = 365, oosDays = 182, stepDays = 182;
  const first = bars[0].date, last = bars[bars.length - 1].date;
  const totalDays = Math.floor((last.getTime() - first.getTime()) / DAY_MS) + 1;

  const eSharpes: number[] = [], bhSharpes: number[] = [];
  const eMaxDds: number[] = [], bhMaxDds: number[] = [];
  let nWin = 0;

  for (let d = 0; d + isDays + oosDays <= totalDays; d += stepDays) {
    const oosStart = new Date(first.getTime() + (d + isDays) * DAY_MS);
    const oosEnd = new Date(first.getTime() + (d + isDays + oosDays - 1) * DAY_MS);
    const oosBars = slice(bars, oosStart, oosEnd);
    if (oosBars.length < 2) continue;
    // signal history needs full lookback up to oosEnd (percentile/SMA warmup)
    const e = runWeightedBacktest({
      asset, btcBars: oosBars, onchainBars: [],
      dxyBars: slice(dxy, dxy[0].date, oosEnd), vixBars: slice(vix, vix[0]?.date ?? oosStart, oosEnd),
      fundingBars: slice(funding, funding[0].date, oosEnd), tnxBars: slice(tnx, tnx[0]?.date ?? oosStart, oosEnd),
      params: PARAMS, initialCapital: 10_000,
    });
    const bh = buyAndHold(oosBars);
    if (!bh) continue;
    eSharpes.push(safe(e.sharpe)); bhSharpes.push(safe(bh.sharpe));
    eMaxDds.push(e.maxDrawdown); bhMaxDds.push(bh.maxDrawdown);
    nWin++;
  }

  // full-period (reference)
  const eFull = runWeightedBacktest({
    asset, btcBars: bars, onchainBars: [], dxyBars: dxy, vixBars: vix,
    fundingBars: funding, tnxBars: tnx, params: PARAMS, initialCapital: 10_000,
  });
  const bhFull = buyAndHold(bars)!;

  console.log(`\n========== ${asset} (${nWin} OOS windows, 固定パラメータ) ==========`);
  console.log(`                       Scheme E      Buy & Hold     差`);
  const row = (label: string, a: number, b: number, fmt = (x: number) => x.toFixed(3)) =>
    console.log(`  ${label.padEnd(20)} ${fmt(a).padEnd(13)} ${fmt(b).padEnd(13)} ${(a - b >= 0 ? "+" : "") + fmt(a - b)}`);
  console.log(`  --- 窓平均 OOS (同一方法・公平) ---`);
  row("Sharpe (窓平均)", avg(eSharpes), avg(bhSharpes));
  console.log(`  --- full-period 参考 ---`);
  row("Sharpe (全期間)", eFull.sharpe, bhFull.sharpe);
  row("Max DD", eFull.maxDrawdown, bhFull.maxDrawdown, (x) => `${(x * 100).toFixed(1)}%`);
  row("総リターン", eFull.totalReturn, bhFull.totalReturn, (x) => `${(x * 100).toFixed(0)}%`);

  const eWins = eSharpes.filter((s, i) => s > bhSharpes[i]).length;
  console.log(`  → 窓ごと勝率: Scheme E が BH を上回った窓 ${eWins}/${nWin}`);
  return { asset, eWinAvg: avg(eSharpes), bhWinAvg: avg(bhSharpes), eWins, nWin };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    await runAsset(prisma, "BTC-USD", "BTCUSDT", "2019-10-01");
    await runAsset(prisma, "ETH-USD", "ETHUSDT", "2019-11-01");
  } finally {
    await prisma.$disconnect();
  }
}
main();
