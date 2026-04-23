import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import fs from "node:fs/promises";
import path from "node:path";
import { loadBars } from "../src/backtest/runner-helpers.js";
import {
  runContinuousV4Backtest,
  type ContinuousV4Params,
  type ContinuousV4Result,
} from "../src/backtest/continuous-sizing-v4-engine.js";
import { runContinuousV2Backtest } from "../src/backtest/continuous-sizing-v2-engine.js";
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
    date: r.date,
    priceUsd: r.priceUsd,
    capMrktUsd: r.capMrktUsd,
    txCnt: r.txCnt,
    adrActCnt: r.adrActCnt,
  }));
}

async function loadMacroBars(prisma: PrismaClient, ticker: string, s: Date, e: Date): Promise<DailyBar[]> {
  const rows = await prisma.macroBar.findMany({
    where: { ticker, date: { gte: s, lte: e } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({
    date: r.date,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));
}

async function loadFundingBars(prisma: PrismaClient, s: Date, e: Date): Promise<FundingBar[]> {
  const rows = await prisma.fundingRate.findMany({
    where: { symbol: "BTCUSDT", date: { gte: s, lte: e } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({ date: r.date, avgRate: r.avgRate, count: r.count }));
}

function cartesian(
  grid: { [K in keyof ContinuousV4Params]?: number[] },
  fixed: Partial<ContinuousV4Params>,
): ContinuousV4Params[] {
  const keys = Object.keys(grid) as (keyof ContinuousV4Params)[];
  let combos: Array<Partial<ContinuousV4Params>> = [{ ...fixed }];
  for (const k of keys) {
    const values = grid[k]!;
    const next: Array<Partial<ContinuousV4Params>> = [];
    for (const c of combos) for (const v of values) next.push({ ...c, [k]: v });
    combos = next;
  }
  return combos as ContinuousV4Params[];
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
    const funding = await loadFundingBars(prisma, start.toDate(), end.toDate());

    console.log(`\n========================================`);
    console.log(`Walk-Forward: Continuous Sizing v4 (5-signal: onchain + DXY + VIX + funding + TNX)`);
    console.log(`Period: ${start.format("YYYY-MM-DD")} -> ${end.format("YYYY-MM-DD")} (6.5y)`);
    console.log(
      `BTC ${btc.length} / Onchain ${onchain.length} / DXY ${dxy.length} / VIX ${vix.length} / TNX ${tnx.length} / Funding ${funding.length}`,
    );
    console.log(`========================================`);

    const paramGrid: { [K in keyof ContinuousV4Params]?: number[] } = {
      dxySmaPeriod: [100, 200],
      vixThreshold: [25, 30],
      rebalanceThreshold: [0.05, 0.1, 0.2],
    };
    const fixed: Partial<ContinuousV4Params> = {
      nvtLookback: 14,
      aaLookback: 30,
      percentileWindow: 365,
      fundingLookback: 365,
      tnxLookback: 365,
    };
    const combos = cartesian(paramGrid, fixed);
    console.log(`Param combos: ${combos.length}`);

    const firstDate = btc[0].date;
    const lastDate = btc[btc.length - 1].date;
    const totalDays = Math.floor((lastDate.getTime() - firstDate.getTime()) / DAY_MS) + 1;

    interface Window {
      idx: number;
      isStart: Date;
      isEnd: Date;
      oosStart: Date;
      oosEnd: Date;
      bestParams: ContinuousV4Params;
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

      const isBtc = sliceWindow(btc, isStart, isEnd);
      const oosBtc = sliceWindow(btc, oosStart, oosEnd);
      if (isBtc.length === 0 || oosBtc.length === 0) { idx++; continue; }

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

      let best: { params: ContinuousV4Params; result: ContinuousV4Result } | null = null;
      for (const params of combos) {
        const r = runContinuousV4Backtest({
          btcBars: isBtc, onchainBars: isOn, dxyBars: isDxy, vixBars: isVix, fundingBars: isFund, tnxBars: isTnx,
          params, initialCapital,
        });
        if (!best || normalizeSharpe(r.sharpe) > normalizeSharpe(best.result.sharpe)) {
          best = { params, result: r };
        }
      }
      if (!best) { idx++; continue; }

      const oos = runContinuousV4Backtest({
        btcBars: oosBtc, onchainBars: oosOn, dxyBars: oosDxy, vixBars: oosVix, fundingBars: oosFund, tnxBars: oosTnx,
        params: best.params, initialCapital,
      });

      windows.push({
        idx,
        isStart: isBtc[0].date,
        isEnd: isBtc[isBtc.length - 1].date,
        oosStart: oosBtc[0].date,
        oosEnd: oosBtc[oosBtc.length - 1].date,
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
    const isAvg = avg(windows.map((w) => w.isSharpe));
    const drop = isAvg > 0 ? (isAvg - oosAvgSharpe) / isAvg : 0;
    const bh = buyAndHold(btc);

    console.log(
      `\n=== R6 v4 (6.5y, 5-signal) ===\nWindows: ${windows.length} | OOS Sharpe: ${oosAvgSharpe.toFixed(3)} | MAR: ${oosAvgMar.toFixed(3)} | PF: ${oosAvgPf.toFixed(3)} | Max DD: ${(oosMaxDd * 100).toFixed(2)}% | drop: ${(drop * 100).toFixed(1)}%`,
    );

    // Re-run R5 v2 (4-signal, no TNX) on same 6.5y
    console.log(`\n=== Re-run R5 v2 (4-signal, no TNX) on 6.5y ===`);
    const r5Combos: Array<{
      nvtLookback: number;
      aaLookback: number;
      percentileWindow: number;
      dxySmaPeriod: number;
      vixThreshold: number;
      fundingLookback: number;
      rebalanceThreshold: number;
    }> = [];
    for (const dx of [100, 200])
      for (const v of [25, 30])
        for (const fl of [180, 365])
          for (const rb of [0.05, 0.1, 0.2])
            r5Combos.push({
              nvtLookback: 14,
              aaLookback: 30,
              percentileWindow: 365,
              dxySmaPeriod: dx,
              vixThreshold: v,
              fundingLookback: fl,
              rebalanceThreshold: rb,
            });

    const r5Windows: { isSharpe: number; oosSharpe: number; oosMaxDd: number; oosMar: number }[] = [];
    let r5idx = 0;
    for (let startDay = 0; startDay + isDays + oosDays <= totalDays; startDay += stepDays) {
      const isStart = new Date(firstDate.getTime() + startDay * DAY_MS);
      const isEnd = new Date(firstDate.getTime() + (startDay + isDays - 1) * DAY_MS);
      const oosStart = new Date(firstDate.getTime() + (startDay + isDays) * DAY_MS);
      const oosEnd = new Date(firstDate.getTime() + (startDay + isDays + oosDays - 1) * DAY_MS);
      const isBtc = sliceWindow(btc, isStart, isEnd);
      const oosBtc = sliceWindow(btc, oosStart, oosEnd);
      if (isBtc.length === 0 || oosBtc.length === 0) { r5idx++; continue; }
      const isOn = sliceWindow(onchain, onchain[0].date, isEnd);
      const oosOn = sliceWindow(onchain, onchain[0].date, oosEnd);
      const isDxy = sliceWindow(dxy, dxy[0]?.date ?? isStart, isEnd);
      const oosDxy = sliceWindow(dxy, dxy[0]?.date ?? oosStart, oosEnd);
      const isVix = sliceWindow(vix, vix[0]?.date ?? isStart, isEnd);
      const oosVix = sliceWindow(vix, vix[0]?.date ?? oosStart, oosEnd);
      const isFund = sliceWindow(funding, funding[0]?.date ?? isStart, isEnd);
      const oosFund = sliceWindow(funding, funding[0]?.date ?? oosStart, oosEnd);

      let best: { params: (typeof r5Combos)[0]; sharpe: number } | null = null;
      for (const params of r5Combos) {
        const r = runContinuousV2Backtest({
          btcBars: isBtc, onchainBars: isOn, dxyBars: isDxy, vixBars: isVix, fundingBars: isFund,
          params, initialCapital,
        });
        if (!best || normalizeSharpe(r.sharpe) > normalizeSharpe(best.sharpe)) {
          best = { params, sharpe: r.sharpe };
        }
      }
      if (!best) { r5idx++; continue; }
      const oos = runContinuousV2Backtest({
        btcBars: oosBtc, onchainBars: oosOn, dxyBars: oosDxy, vixBars: oosVix, fundingBars: oosFund,
        params: best.params, initialCapital,
      });
      r5Windows.push({
        isSharpe: safeKpi(best.sharpe),
        oosSharpe: safeKpi(oos.sharpe),
        oosMar: safeKpi(oos.mar),
        oosMaxDd: oos.maxDrawdown,
      });
      r5idx++;
    }
    const r5Avg = avg(r5Windows.map((w) => w.oosSharpe));
    const r5Dd = r5Windows.length ? Math.max(...r5Windows.map((w) => w.oosMaxDd)) : 0;
    const r5Mar = avg(r5Windows.map((w) => w.oosMar));
    const r5IsAvg = avg(r5Windows.map((w) => w.isSharpe));
    const r5Drop = r5IsAvg > 0 ? (r5IsAvg - r5Avg) / r5IsAvg : 0;

    console.log(`Windows: ${r5Windows.length} | OOS Sharpe: ${r5Avg.toFixed(3)} | MAR: ${r5Mar.toFixed(3)} | Max DD: ${(r5Dd * 100).toFixed(2)}% | drop: ${(r5Drop * 100).toFixed(1)}%`);

    if (bh) {
      console.log(`\n=== BH benchmark (6.5y) ===\nSharpe: ${bh.sharpe.toFixed(3)} | DD: ${(bh.maxDrawdown * 100).toFixed(2)}%`);
    }

    console.log(`\n=== 6.5y Summary ===`);
    console.log(`BH 6.5y   : Sharpe ${bh?.sharpe.toFixed(3)} | DD ${((bh?.maxDrawdown ?? 0) * 100).toFixed(2)}%`);
    console.log(`R5 v2 (4) : Sharpe ${r5Avg.toFixed(3)} | DD ${(r5Dd * 100).toFixed(2)}% | drop ${(r5Drop * 100).toFixed(1)}%`);
    console.log(`R6 v4 (5) : Sharpe ${oosAvgSharpe.toFixed(3)} | DD ${(oosMaxDd * 100).toFixed(2)}% | drop ${(drop * 100).toFixed(1)}%`);

    const passed = oosAvgSharpe >= 1.0 && oosMaxDd <= 0.5 && drop <= 0.3 && (!bh || oosAvgSharpe > bh.sharpe);
    console.log(`\nStrict criteria (Sharpe ≥ 1.0 & DD ≤ 50% & drop ≤ 30% & beats BH): ${passed ? "PASS ★★" : "FAIL"}`);

    await prisma.walkForwardRun.create({
      data: {
        strategy: "continuous-sizing-v4",
        assetSymbol: "BTC-USD",
        startDate: start.toDate(),
        endDate: end.toDate(),
        isDays,
        oosDays,
        stepDays,
        oosAvgSharpe: safeKpi(oosAvgSharpe),
        oosAvgMar: safeKpi(oosAvgMar),
        oosAvgPf: safeKpi(oosAvgPf),
        oosMaxDd: safeKpi(oosMaxDd),
        isOosSharpeDrop: safeKpi(drop),
        passed,
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
    const filepath = path.join(outDir, `continuous-sizing-v4-BTC-USD-${ts}.md`);
    const lines: string[] = [
      `# Walk-Forward Report: Continuous Sizing v4 (5-signal, BTC-USD)`,
      ``,
      `**Period:** ${start.format("YYYY-MM-DD")} – ${end.format("YYYY-MM-DD")} (6.5y)`,
      `**Signals:** Onchain + DXY + VIX + Funding + TNX`,
      `**Windows:** ${windows.length}`,
      `**Robustness:** ${passed ? "PASS ★★" : "FAIL"}`,
      ``,
      `## Comparison (6.5y)`,
      ``,
      `| Strategy | OOS Sharpe | OOS Max DD | IS→OOS Drop | Beats BH? |`,
      `|---|---|---|---|---|`,
      `| BH 6.5y | ${bh?.sharpe.toFixed(3)} | ${((bh?.maxDrawdown ?? 0) * 100).toFixed(2)}% | — | baseline |`,
      `| R5 v2 (4-sig) | ${r5Avg.toFixed(3)} | ${(r5Dd * 100).toFixed(2)}% | ${(r5Drop * 100).toFixed(1)}% | ${bh && r5Avg > bh.sharpe ? "YES" : "NO"} |`,
      `| **R6 v4 (5-sig)** | **${oosAvgSharpe.toFixed(3)}** | **${(oosMaxDd * 100).toFixed(2)}%** | **${(drop * 100).toFixed(1)}%** | **${bh && oosAvgSharpe > bh.sharpe ? "YES ★" : "NO"}** |`,
      ``,
      `## R6 v4 OOS KPIs`,
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
      `## Parameter Grid`,
      ``,
      "```json",
      JSON.stringify(paramGrid, null, 2),
      "```",
      ``,
      `## Windows`,
      ``,
      `| # | IS Period | OOS Period | Best Params | IS Sharpe | OOS Sharpe | OOS MAR | OOS PF | OOS DD |`,
      `|---|---|---|---|---|---|---|---|---|`,
    ];
    for (const w of windows) {
      const ps = Object.entries(w.bestParams).map(([k, v]) => `${k}=${v}`).join(", ");
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
