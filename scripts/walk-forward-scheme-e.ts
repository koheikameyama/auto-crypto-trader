import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import fs from "node:fs/promises";
import path from "node:path";
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
import type { AssetSymbol } from "../src/types/asset.js";

// Generalized Scheme E cross-asset walk-forward. A parametrized version of
// walk-forward-scheme-e-eth.ts so any asset (ETH/SOL/BNB) can be validated
// against the FIXED BTC weights (wDxy=0.60, wFunding=0.40). No in-sample
// weight optimization — only hyper (dxySmaPeriod, rebalanceThreshold) selection.
//
// Usage:
//   npx tsx scripts/walk-forward-scheme-e.ts --asset=SOL-USD --funding=SOLUSDT --start=2020-09-01
//   npx tsx scripts/walk-forward-scheme-e.ts --asset=BNB-USD --funding=BNBUSDT --start=2020-02-01

const DAY_MS = 24 * 60 * 60 * 1000;

interface CliArgs {
  asset: AssetSymbol;
  funding: string;
  start: string;
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  let asset: string | undefined;
  let funding: string | undefined;
  let start: string | undefined;
  for (const a of args) {
    if (a.startsWith("--asset=")) asset = a.slice("--asset=".length);
    else if (a.startsWith("--funding=")) funding = a.slice("--funding=".length);
    else if (a.startsWith("--start=")) start = a.slice("--start=".length);
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (!asset || !funding || !start) {
    throw new Error(
      "Required: --asset=<SYMBOL-USD> --funding=<BINANCE_PERP> --start=YYYY-MM-DD",
    );
  }
  return { asset: asset as AssetSymbol, funding, start };
}

async function loadOnchainBars(prisma: PrismaClient, s: Date, e: Date): Promise<OnchainBar[]> {
  // wOnchain=0 so unused; BTC onchain kept only as a shape-compatible placeholder.
  const a = await prisma.asset.findUnique({ where: { symbol: "BTC-USD" } });
  if (!a) return [];
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

async function main() {
  const { asset, funding, start: startIso } = parseArgs();
  const prisma = new PrismaClient();
  try {
    const isDays = 365;
    const oosDays = 182;
    const stepDays = 182;
    const initialCapital = 10_000;
    const start = dayjs(startIso);
    const end = dayjs();

    const assetBars = await loadBars(prisma, asset, start.toDate(), end.toDate());
    if (assetBars.length === 0) {
      throw new Error(`No DailyBar rows for ${asset}. Run backfill-crypto-prices first.`);
    }
    const onchain = await loadOnchainBars(prisma, start.toDate(), end.toDate());
    const dxy = await loadMacroBars(prisma, "DX-Y.NYB", start.toDate(), end.toDate());
    const vix = await loadMacroBars(prisma, "^VIX", start.toDate(), end.toDate());
    const tnx = await loadMacroBars(prisma, "^TNX", start.toDate(), end.toDate());
    const fundingBars = await loadFundingBars(prisma, funding, start.toDate(), end.toDate());
    if (fundingBars.length === 0) {
      throw new Error(`No FundingRate rows for ${funding}. Run funding backfill first.`);
    }

    console.log(`\n========================================`);
    console.log(`Scheme E on ${asset} (cross-asset validation)`);
    console.log(`Weights: wDxy=0.60, wFunding=0.40 (all others = 0, FIXED)`);
    console.log(`Period: ${start.format("YYYY-MM-DD")} -> ${end.format("YYYY-MM-DD")}`);
    console.log(`${asset} ${assetBars.length} / DXY ${dxy.length} / VIX ${vix.length} / TNX ${tnx.length} / Funding(${funding}) ${fundingBars.length}`);
    console.log(`========================================\n`);

    const hyperGrid = [
      { dxySmaPeriod: 100, vixThreshold: 30, rebalanceThreshold: 0.1 },
      { dxySmaPeriod: 200, vixThreshold: 30, rebalanceThreshold: 0.1 },
      { dxySmaPeriod: 200, vixThreshold: 30, rebalanceThreshold: 0.05 },
    ];

    const firstDate = assetBars[0].date;
    const lastDate = assetBars[assetBars.length - 1].date;
    const totalDays = Math.floor((lastDate.getTime() - firstDate.getTime()) / DAY_MS) + 1;

    interface Window {
      idx: number;
      isStart: Date;
      isEnd: Date;
      oosStart: Date;
      oosEnd: Date;
      bestParams: WeightedParams;
      isSharpe: number;
      oosSharpe: number;
      oosMar: number;
      oosPf: number;
      oosMaxDd: number;
      oosTotalReturn: number;
    }
    const windows: Window[] = [];

    let idx = 0;
    for (let startDay = 0; startDay + isDays + oosDays <= totalDays; startDay += stepDays) {
      const isStart = new Date(firstDate.getTime() + startDay * DAY_MS);
      const isEnd = new Date(firstDate.getTime() + (startDay + isDays - 1) * DAY_MS);
      const oosStart = new Date(firstDate.getTime() + (startDay + isDays) * DAY_MS);
      const oosEnd = new Date(firstDate.getTime() + (startDay + isDays + oosDays - 1) * DAY_MS);

      const isAsset = sliceWindow(assetBars, isStart, isEnd);
      const oosAsset = sliceWindow(assetBars, oosStart, oosEnd);
      if (isAsset.length === 0 || oosAsset.length === 0) { idx++; continue; }

      const isOn = onchain.length > 0 ? sliceWindow(onchain, onchain[0].date, isEnd) : [];
      const oosOn = onchain.length > 0 ? sliceWindow(onchain, onchain[0].date, oosEnd) : [];
      const isDxy = sliceWindow(dxy, dxy[0]?.date ?? isStart, isEnd);
      const oosDxy = sliceWindow(dxy, dxy[0]?.date ?? oosStart, oosEnd);
      const isVix = sliceWindow(vix, vix[0]?.date ?? isStart, isEnd);
      const oosVix = sliceWindow(vix, vix[0]?.date ?? oosStart, oosEnd);
      const isTnx = sliceWindow(tnx, tnx[0]?.date ?? isStart, isEnd);
      const oosTnx = sliceWindow(tnx, tnx[0]?.date ?? oosStart, oosEnd);
      const isFund = sliceWindow(fundingBars, fundingBars[0]?.date ?? isStart, isEnd);
      const oosFund = sliceWindow(fundingBars, fundingBars[0]?.date ?? oosStart, oosEnd);

      let best: { params: WeightedParams; result: WeightedResult } | null = null;
      for (const hp of hyperGrid) {
        const params: WeightedParams = {
          nvtLookback: 14, aaLookback: 30, percentileWindow: 365,
          dxySmaPeriod: hp.dxySmaPeriod, vixThreshold: hp.vixThreshold,
          fundingLookback: 365, tnxLookback: 365,
          rebalanceThreshold: hp.rebalanceThreshold,
          wOnchain: 0, wDxy: 0.60, wVix: 0, wFunding: 0.40, wTnx: 0,
        };
        const r = runWeightedBacktest({
          asset,
          btcBars: isAsset, onchainBars: isOn, dxyBars: isDxy, vixBars: isVix,
          fundingBars: isFund, tnxBars: isTnx,
          params, initialCapital,
        });
        if (!best || normalizeSharpe(r.sharpe) > normalizeSharpe(best.result.sharpe)) {
          best = { params, result: r };
        }
      }
      if (!best) { idx++; continue; }

      const oos = runWeightedBacktest({
        asset,
        btcBars: oosAsset, onchainBars: oosOn, dxyBars: oosDxy, vixBars: oosVix,
        fundingBars: oosFund, tnxBars: oosTnx,
        params: best.params, initialCapital,
      });

      windows.push({
        idx,
        isStart: isAsset[0].date,
        isEnd: isAsset[isAsset.length - 1].date,
        oosStart: oosAsset[0].date,
        oosEnd: oosAsset[oosAsset.length - 1].date,
        bestParams: best.params,
        isSharpe: safeKpi(best.result.sharpe),
        oosSharpe: safeKpi(oos.sharpe),
        oosMar: safeKpi(oos.mar),
        oosPf: safeKpi(oos.profitFactor),
        oosMaxDd: oos.maxDrawdown,
        oosTotalReturn: oos.totalReturn,
      });
      idx++;
    }

    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    const oosAvgSharpe = avg(windows.map((w) => w.oosSharpe));
    const oosAvgMar = avg(windows.map((w) => w.oosMar));
    const oosAvgPf = avg(windows.map((w) => w.oosPf));
    const oosMaxDd = windows.length ? Math.max(...windows.map((w) => w.oosMaxDd)) : 0;
    const oosAvgTotalReturn = avg(windows.map((w) => w.oosTotalReturn));
    const isAvgSharpe = avg(windows.map((w) => w.isSharpe));
    const drop = isAvgSharpe > 0 ? (isAvgSharpe - oosAvgSharpe) / isAvgSharpe : 0;

    const bh = buyAndHold(assetBars);

    console.log(
      `=== Scheme E on ${asset} ===\nWindows: ${windows.length} | OOS Sharpe: ${oosAvgSharpe.toFixed(3)} | MAR: ${oosAvgMar.toFixed(3)} | PF: ${oosAvgPf.toFixed(3)} | Max DD: ${(oosMaxDd * 100).toFixed(2)}% | Drop: ${(drop * 100).toFixed(1)}%`,
    );

    if (bh) {
      console.log(`\n=== BH ${asset} ===\nSharpe ${bh.sharpe.toFixed(3)} | DD ${(bh.maxDrawdown * 100).toFixed(2)}% | TotalRet ${(bh.totalReturn * 100).toFixed(1)}%`);
      console.log(`Beats ${asset} BH: ${oosAvgSharpe > bh.sharpe ? "YES ★" : "NO"} (${oosAvgSharpe.toFixed(3)} vs ${bh.sharpe.toFixed(3)})`);
    }

    const strictPass = oosAvgSharpe >= 1.0 && oosMaxDd <= 0.5 && drop <= 0.3 && !!bh && oosAvgSharpe > bh.sharpe;
    const weakPass = oosAvgSharpe >= 0.9 && !!bh && oosAvgSharpe > bh.sharpe && drop <= 0.3;
    console.log(`\nStrict criteria: ${strictPass ? "PASS ★" : "FAIL"}`);
    console.log(`Weak criteria (Sharpe ≥ 0.9 & Beats BH & drop ≤ 30%): ${weakPass ? "PASS" : "FAIL"}`);

    await prisma.walkForwardRun.create({
      data: {
        strategy: `scheme-e-${asset.toLowerCase().replace("-usd", "")}`,
        assetSymbol: asset,
        startDate: start.toDate(), endDate: end.toDate(),
        isDays, oosDays, stepDays,
        oosAvgSharpe: safeKpi(oosAvgSharpe),
        oosAvgMar: safeKpi(oosAvgMar),
        oosAvgPf: safeKpi(oosAvgPf),
        oosMaxDd: safeKpi(oosMaxDd),
        isOosSharpeDrop: safeKpi(drop),
        passed: strictPass,
        windows: windows.map((w) => ({
          windowIndex: w.idx,
          isStart: w.isStart.toISOString(),
          isEnd: w.isEnd.toISOString(),
          oosStart: w.oosStart.toISOString(),
          oosEnd: w.oosEnd.toISOString(),
          bestParams: w.bestParams,
          isSharpe: safeKpi(w.isSharpe),
          oosSharpe: safeKpi(w.oosSharpe),
          oosMar: safeKpi(w.oosMar),
          oosPf: safeKpi(w.oosPf),
          oosMaxDd: safeKpi(w.oosMaxDd),
          oosTrades: 0,
          oosTotalReturn: safeKpi(w.oosTotalReturn),
        })),
      },
    });

    const outDir = "reports/walk-forward";
    await fs.mkdir(outDir, { recursive: true });
    const ts = dayjs().format("YYYYMMDD-HHmmss");
    const shortName = asset.toLowerCase().replace("-usd", "");
    const filepath = path.join(outDir, `scheme-e-${shortName}-${ts}.md`);
    const lines: string[] = [
      `# Walk-Forward Report: Scheme E on ${asset} (cross-asset validation)`,
      ``,
      `**Period:** ${start.format("YYYY-MM-DD")} – ${end.format("YYYY-MM-DD")}`,
      `**Weights:** wDxy=0.60, wFunding=0.40 (fixed, from BTC Scheme E)`,
      `**Funding symbol:** ${funding}`,
      `**Windows:** ${windows.length}`,
      `**Robustness:** ${strictPass ? "PASS ★" : weakPass ? "WEAK PASS" : "FAIL"}`,
      ``,
      `## Comparison`,
      ``,
      `| Strategy | OOS Sharpe | OOS Max DD | IS→OOS Drop | Beats BH? |`,
      `|---|---|---|---|---|`,
      `| ${asset} BH | ${bh?.sharpe.toFixed(3)} | ${((bh?.maxDrawdown ?? 0) * 100).toFixed(2)}% | — | baseline |`,
      `| **Scheme E on ${asset}** | **${oosAvgSharpe.toFixed(3)}** | **${(oosMaxDd * 100).toFixed(2)}%** | **${(drop * 100).toFixed(1)}%** | **${bh && oosAvgSharpe > bh.sharpe ? "YES ★" : "NO"}** |`,
      ``,
      `## OOS KPIs`,
      ``,
      `| Metric | Value |`,
      `|---|---|`,
      `| OOS Avg Sharpe | ${oosAvgSharpe.toFixed(3)} |`,
      `| OOS Avg MAR | ${oosAvgMar.toFixed(3)} |`,
      `| OOS Avg PF | ${oosAvgPf.toFixed(3)} |`,
      `| OOS Max DD | ${(oosMaxDd * 100).toFixed(2)}% |`,
      `| OOS Avg Total Return | ${(oosAvgTotalReturn * 100).toFixed(2)}% |`,
      `| IS->OOS Drop | ${(drop * 100).toFixed(2)}% |`,
      ``,
      `## Windows`,
      ``,
      `| # | IS Period | OOS Period | Best Params | IS Sharpe | OOS Sharpe | OOS MAR | OOS PF | OOS DD |`,
      `|---|---|---|---|---|---|---|---|---|`,
    ];
    for (const w of windows) {
      const ps = Object.entries(w.bestParams).filter(([k]) => ["dxySmaPeriod", "rebalanceThreshold"].includes(k)).map(([k, v]) => `${k}=${v}`).join(", ");
      lines.push(
        `| ${w.idx} | ${dayjs(w.isStart).format("YY-MM-DD")}->${dayjs(w.isEnd).format("YY-MM-DD")} | ${dayjs(w.oosStart).format("YY-MM-DD")}->${dayjs(w.oosEnd).format("YY-MM-DD")} | ${ps} | ${w.isSharpe.toFixed(2)} | ${w.oosSharpe.toFixed(2)} | ${w.oosMar.toFixed(2)} | ${w.oosPf.toFixed(2)} | ${(w.oosMaxDd * 100).toFixed(1)}% |`,
      );
    }
    await fs.writeFile(filepath, lines.join("\n"), "utf-8");
    console.log(`\nReport: ${filepath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
