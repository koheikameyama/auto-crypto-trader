import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { loadBars } from "../src/backtest/runner-helpers.js";
import {
  runWeightedBacktest,
  type WeightedParams,
  type WeightedResult,
} from "../src/backtest/weighted-ensemble-engine.js";
import { buyAndHold } from "../src/lib/buy-and-hold.js";
import type { OnchainBar } from "../src/data/onchain-loader.js";
import type { FundingBar } from "../src/data/funding-loader.js";
import type { DailyBar } from "../src/types/bar.js";

const DAY_MS = 24 * 60 * 60 * 1000;

async function loadOnchainBars(prisma: PrismaClient, s: Date, e: Date): Promise<OnchainBar[]> {
  const a = await prisma.asset.findUnique({ where: { symbol: "BTC-USD" } });
  if (!a) throw new Error("Asset BTC-USD not found");
  const rows = await prisma.onchainMetric.findMany({
    where: { assetId: a.id, date: { gte: s, lte: e } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({
    date: r.date, priceUsd: r.priceUsd, capMrktUsd: r.capMrktUsd,
    txCnt: r.txCnt, adrActCnt: r.adrActCnt,
  }));
}

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

function sliceWindow<T extends { date: Date }>(bars: T[], s: Date, e: Date): T[] {
  return bars.filter((b) => b.date >= s && b.date <= e);
}

function normalizeSharpe(s: number): number {
  if (Number.isNaN(s)) return Number.NEGATIVE_INFINITY;
  if (s === Infinity) return Number.MAX_SAFE_INTEGER;
  if (s === -Infinity) return Number.NEGATIVE_INFINITY;
  return s;
}

function safeKpi(n: number, max = 999): number {
  if (Number.isNaN(n)) return 0;
  if (n === Infinity) return max;
  if (n === -Infinity) return -max;
  return n;
}

async function runForWeight(
  wDxy: number,
  btc: DailyBar[],
  onchain: OnchainBar[],
  dxy: DailyBar[],
  vix: DailyBar[],
  tnx: DailyBar[],
  funding: FundingBar[],
  isDays: number,
  oosDays: number,
  stepDays: number,
  initialCapital: number,
): Promise<{ oosAvgSharpe: number; oosMaxDd: number; oosAvgMar: number; isOosSharpeDrop: number }> {
  const wFunding = 1 - wDxy;
  const firstDate = btc[0].date;
  const lastDate = btc[btc.length - 1].date;
  const totalDays = Math.floor((lastDate.getTime() - firstDate.getTime()) / DAY_MS) + 1;

  // Small hyper-grid fixed for comparison
  const hyperGrid = [
    { dxySmaPeriod: 200, vixThreshold: 30, rebalanceThreshold: 0.1 },
    { dxySmaPeriod: 100, vixThreshold: 30, rebalanceThreshold: 0.05 },
  ];

  const windows: { isSharpe: number; oosSharpe: number; oosMar: number; oosMaxDd: number }[] = [];

  for (let startDay = 0; startDay + isDays + oosDays <= totalDays; startDay += stepDays) {
    const isStart = new Date(firstDate.getTime() + startDay * DAY_MS);
    const isEnd = new Date(firstDate.getTime() + (startDay + isDays - 1) * DAY_MS);
    const oosStart = new Date(firstDate.getTime() + (startDay + isDays) * DAY_MS);
    const oosEnd = new Date(firstDate.getTime() + (startDay + isDays + oosDays - 1) * DAY_MS);

    const isBtc = sliceWindow(btc, isStart, isEnd);
    const oosBtc = sliceWindow(btc, oosStart, oosEnd);
    if (isBtc.length === 0 || oosBtc.length === 0) continue;
    const isOn = sliceWindow(onchain, onchain[0].date, isEnd);
    const oosOn = sliceWindow(onchain, onchain[0].date, oosEnd);
    const isDxy = sliceWindow(dxy, dxy[0]?.date ?? isStart, isEnd);
    const oosDxy = sliceWindow(dxy, dxy[0]?.date ?? oosStart, oosEnd);
    const isVix = sliceWindow(vix, vix[0]?.date ?? isStart, isEnd);
    const oosVix = sliceWindow(vix, vix[0]?.date ?? oosStart, oosEnd);
    const isTnx = sliceWindow(tnx, tnx[0]?.date ?? isStart, isEnd);
    const oosTnx = sliceWindow(tnx, tnx[0]?.date ?? oosStart, oosEnd);
    const isFund = sliceWindow(funding, funding[0]?.date ?? isStart, isEnd);
    const oosFund = sliceWindow(funding, funding[0]?.date ?? oosStart, oosEnd);

    let best: { params: WeightedParams; result: WeightedResult } | null = null;
    for (const hp of hyperGrid) {
      const params: WeightedParams = {
        nvtLookback: 14, aaLookback: 30, percentileWindow: 365,
        dxySmaPeriod: hp.dxySmaPeriod, vixThreshold: hp.vixThreshold,
        fundingLookback: 365, tnxLookback: 365,
        rebalanceThreshold: hp.rebalanceThreshold,
        wOnchain: 0, wDxy, wVix: 0, wFunding, wTnx: 0,
      };
      const r = runWeightedBacktest({
        btcBars: isBtc, onchainBars: isOn, dxyBars: isDxy, vixBars: isVix,
        fundingBars: isFund, tnxBars: isTnx,
        params, initialCapital,
      });
      if (!best || normalizeSharpe(r.sharpe) > normalizeSharpe(best.result.sharpe)) {
        best = { params, result: r };
      }
    }
    if (!best) continue;
    const oos = runWeightedBacktest({
      btcBars: oosBtc, onchainBars: oosOn, dxyBars: oosDxy, vixBars: oosVix,
      fundingBars: oosFund, tnxBars: oosTnx,
      params: best.params, initialCapital,
    });
    windows.push({
      isSharpe: safeKpi(best.result.sharpe),
      oosSharpe: safeKpi(oos.sharpe),
      oosMar: safeKpi(oos.mar),
      oosMaxDd: oos.maxDrawdown,
    });
  }

  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const oosAvgSharpe = avg(windows.map((w) => w.oosSharpe));
  const oosMaxDd = windows.length ? Math.max(...windows.map((w) => w.oosMaxDd)) : 0;
  const oosAvgMar = avg(windows.map((w) => w.oosMar));
  const isAvg = avg(windows.map((w) => w.isSharpe));
  const isOosSharpeDrop = isAvg > 0 ? (isAvg - oosAvgSharpe) / isAvg : 0;
  return { oosAvgSharpe, oosMaxDd, oosAvgMar, isOosSharpeDrop };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const isDays = 365;
    const oosDays = 182;
    const stepDays = 182;
    const initialCapital = 10_000;
    const start = dayjs("2019-10-01");
    const end = dayjs();

    const btc = await loadBars(prisma, "BTC-USD", start.toDate(), end.toDate());
    const onchain = await loadOnchainBars(prisma, start.toDate(), end.toDate());
    const dxy = await loadMacroBars(prisma, "DX-Y.NYB", start.toDate(), end.toDate());
    const vix = await loadMacroBars(prisma, "^VIX", start.toDate(), end.toDate());
    const tnx = await loadMacroBars(prisma, "^TNX", start.toDate(), end.toDate());
    const funding = await loadFundingBars(prisma, "BTCUSDT", start.toDate(), end.toDate());
    const bh = buyAndHold(btc);

    console.log(`\n========================================`);
    console.log(`Step 1: Weight Sensitivity (Scheme E) — wDxy + wFunding = 1.0`);
    console.log(`Period: ${start.format("YYYY-MM-DD")} -> ${end.format("YYYY-MM-DD")} (6.5y)`);
    console.log(`BTC ${btc.length} / funding ${funding.length}`);
    console.log(`========================================\n`);

    const weightGrid = [0.30, 0.40, 0.50, 0.55, 0.60, 0.65, 0.70, 0.80];
    console.log(
      `| wDxy | wFunding | OOS Sharpe | OOS DD   | OOS MAR | Drop   | Pass? |`,
    );
    console.log(
      `|------|----------|------------|----------|---------|--------|-------|`,
    );
    const results: Array<{
      wDxy: number; wFunding: number; sharpe: number; dd: number; mar: number; drop: number; pass: boolean;
    }> = [];
    for (const wDxy of weightGrid) {
      const r = await runForWeight(wDxy, btc, onchain, dxy, vix, tnx, funding, isDays, oosDays, stepDays, initialCapital);
      const pass = r.oosAvgSharpe >= 1.0 && r.oosMaxDd <= 0.5 && r.isOosSharpeDrop <= 0.3 && !!bh && r.oosAvgSharpe > bh.sharpe;
      results.push({
        wDxy, wFunding: 1 - wDxy, sharpe: r.oosAvgSharpe, dd: r.oosMaxDd, mar: r.oosAvgMar, drop: r.isOosSharpeDrop, pass,
      });
      console.log(
        `| ${wDxy.toFixed(2)} | ${(1 - wDxy).toFixed(2)}     | ${r.oosAvgSharpe.toFixed(3)}      | ${(r.oosMaxDd * 100).toFixed(2)}%  | ${r.oosAvgMar.toFixed(3)}   | ${(r.isOosSharpeDrop * 100).toFixed(1)}%  | ${pass ? "✓ ★" : "✗"} |`,
      );
    }

    if (bh) {
      console.log(`\nBH baseline: Sharpe ${bh.sharpe.toFixed(3)} | DD ${(bh.maxDrawdown * 100).toFixed(2)}%`);
    }

    const passingCount = results.filter((r) => r.pass).length;
    const sharpeAll = results.map((r) => r.sharpe);
    const minSharpe = Math.min(...sharpeAll);
    const maxSharpe = Math.max(...sharpeAll);
    console.log(`\n=== Robustness judgment ===`);
    console.log(`Sharpe range: ${minSharpe.toFixed(3)} – ${maxSharpe.toFixed(3)}`);
    console.log(`Passing weights: ${passingCount} / ${weightGrid.length}`);
    if (passingCount >= 4) {
      console.log(`Verdict: ROBUST — multiple weights pass strict criteria.`);
    } else if (passingCount >= 2) {
      console.log(`Verdict: LOCALLY OK — only few weights pass, investigate.`);
    } else {
      console.log(`Verdict: FRAGILE — very narrow weight range works, likely overfit.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
