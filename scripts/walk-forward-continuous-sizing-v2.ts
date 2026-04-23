import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import fs from "node:fs/promises";
import path from "node:path";
import { loadBars } from "../src/backtest/runner-helpers.js";
import {
  runContinuousV2Backtest,
  type ContinuousV2Params,
  type ContinuousV2Result,
} from "../src/backtest/continuous-sizing-v2-engine.js";
import { runContinuousBacktest } from "../src/backtest/continuous-sizing-engine.js";
import { buyAndHold } from "../src/lib/buy-and-hold.js";
import type { OnchainBar } from "../src/data/onchain-loader.js";
import type { FundingBar } from "../src/data/funding-loader.js";
import type { DailyBar } from "../src/types/bar.js";

const DAY_MS = 24 * 60 * 60 * 1000;

async function loadOnchainBars(
  prisma: PrismaClient,
  s: Date,
  e: Date,
): Promise<OnchainBar[]> {
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

async function loadMacroBars(
  prisma: PrismaClient,
  ticker: string,
  s: Date,
  e: Date,
): Promise<DailyBar[]> {
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

async function loadFundingBars(
  prisma: PrismaClient,
  s: Date,
  e: Date,
): Promise<FundingBar[]> {
  const rows = await prisma.fundingRate.findMany({
    where: { symbol: "BTCUSDT", date: { gte: s, lte: e } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({
    date: r.date,
    avgRate: r.avgRate,
    count: r.count,
  }));
}

function cartesian(
  grid: { [K in keyof ContinuousV2Params]?: number[] },
  fixed: Partial<ContinuousV2Params>,
): ContinuousV2Params[] {
  const keys = Object.keys(grid) as (keyof ContinuousV2Params)[];
  let combos: Array<Partial<ContinuousV2Params>> = [{ ...fixed }];
  for (const k of keys) {
    const values = grid[k]!;
    const next: Array<Partial<ContinuousV2Params>> = [];
    for (const c of combos) for (const v of values) next.push({ ...c, [k]: v });
    combos = next;
  }
  return combos as ContinuousV2Params[];
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
    // Funding data starts 2019-10-01, use from that
    const start = dayjs("2019-10-01");
    const end = dayjs();

    const btc = await loadBars(prisma, "BTC-USD", start.toDate(), end.toDate());
    const onchain = await loadOnchainBars(prisma, start.toDate(), end.toDate());
    const dxy = await loadMacroBars(prisma, "DX-Y.NYB", start.toDate(), end.toDate());
    const vix = await loadMacroBars(prisma, "^VIX", start.toDate(), end.toDate());
    const funding = await loadFundingBars(prisma, start.toDate(), end.toDate());

    console.log(`\n========================================`);
    console.log(`Walk-Forward: Continuous Sizing v2 (4-signal, funding included)`);
    console.log(`Period: ${start.format("YYYY-MM-DD")} -> ${end.format("YYYY-MM-DD")}`);
    console.log(
      `BTC ${btc.length} / Onchain ${onchain.length} / DXY ${dxy.length} / VIX ${vix.length} / Funding ${funding.length}`,
    );
    console.log(`========================================`);

    const paramGrid: { [K in keyof ContinuousV2Params]?: number[] } = {
      dxySmaPeriod: [100, 200],
      vixThreshold: [25, 30],
      fundingLookback: [180, 365],
      rebalanceThreshold: [0.05, 0.1, 0.2],
    };
    const fixed: Partial<ContinuousV2Params> = {
      nvtLookback: 14,
      aaLookback: 30,
      percentileWindow: 365,
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
      bestParams: ContinuousV2Params;
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
      const isFund = sliceWindow(funding, funding[0]?.date ?? isStart, isEnd);
      const oosFund = sliceWindow(funding, funding[0]?.date ?? oosStart, oosEnd);

      // Optimize IS
      let best: { params: ContinuousV2Params; result: ContinuousV2Result } | null = null;
      for (const params of combos) {
        const r = runContinuousV2Backtest({
          btcBars: isBtc,
          onchainBars: isOn,
          dxyBars: isDxy,
          vixBars: isVix,
          fundingBars: isFund,
          params,
          initialCapital,
        });
        if (!best || normalizeSharpe(r.sharpe) > normalizeSharpe(best.result.sharpe)) {
          best = { params, result: r };
        }
      }
      if (!best) { idx++; continue; }

      const oos = runContinuousV2Backtest({
        btcBars: oosBtc,
        onchainBars: oosOn,
        dxyBars: oosDxy,
        vixBars: oosVix,
        fundingBars: oosFund,
        params: best.params,
        initialCapital,
      });

      windows.push({
        idx,
        isStart: isBtc[0].date,
        isEnd: isBtc[isBtc.length - 1].date,
        oosStart: oosBtc[0].date,
        oosEnd: oosBtc[oosBtc.length - 1].date,
        bestParams: best.params,
        isSharpe: safeKpi(best.result.sharpe, 999),
        oosSharpe: safeKpi(oos.sharpe, 999),
        oosMar: safeKpi(oos.mar, 999),
        oosPf: safeKpi(oos.profitFactor, 999),
        oosMaxDd: oos.maxDrawdown,
        oosTotalReturn: oos.totalReturn,
      });
      idx++;
    }

    const avg = (xs: number[]) => (xs.length ? xs.reduce((a,b)=>a+b,0)/xs.length : 0);
    const oosAvgSharpe = avg(windows.map(w => w.oosSharpe));
    const oosAvgMar = avg(windows.map(w => w.oosMar));
    const oosAvgPf = avg(windows.map(w => w.oosPf));
    const oosMaxDd = windows.length ? Math.max(...windows.map(w => w.oosMaxDd)) : 0;
    const oosAvgTotalReturn = avg(windows.map(w => w.oosTotalReturn));
    const isAvg = avg(windows.map(w => w.isSharpe));
    const drop = isAvg > 0 ? (isAvg - oosAvgSharpe) / isAvg : 0;
    const bh = buyAndHold(btc);

    console.log(
      `\n=== R5 v2 (4-signal) ===\nWindows: ${windows.length} | OOS Sharpe: ${oosAvgSharpe.toFixed(3)} | MAR: ${oosAvgMar.toFixed(3)} | PF: ${oosAvgPf.toFixed(3)} | Max DD: ${(oosMaxDd*100).toFixed(2)}% | drop: ${(drop*100).toFixed(1)}%`,
    );

    // Also run R4d Step 3 on the same 6.5y period for direct comparison
    console.log(`\n=== Re-run R4d Step 3 (3-signal) on same 6.5y period for comparison ===`);

    type R3Params = {
      nvtLookback: number;
      aaLookback: number;
      percentileWindow: number;
      dxySmaPeriod: number;
      vixThreshold: number;
      rebalanceThreshold: number;
    };
    const r3Grid = {
      dxySmaPeriod: [100, 200],
      vixThreshold: [25, 30, 35],
      rebalanceThreshold: [0.05, 0.1, 0.2],
    };
    const r3Fixed: Partial<R3Params> = {
      nvtLookback: 14,
      aaLookback: 30,
      percentileWindow: 365,
    };
    const r3Combos: R3Params[] = [];
    for (const dxy of r3Grid.dxySmaPeriod)
      for (const v of r3Grid.vixThreshold)
        for (const rb of r3Grid.rebalanceThreshold)
          r3Combos.push({ ...r3Fixed, dxySmaPeriod: dxy, vixThreshold: v, rebalanceThreshold: rb } as R3Params);

    const r3Windows: { isSharpe: number; oosSharpe: number; oosMaxDd: number; oosMar: number }[] = [];
    let r3idx = 0;
    for (let startDay = 0; startDay + isDays + oosDays <= totalDays; startDay += stepDays) {
      const isStart = new Date(firstDate.getTime() + startDay * DAY_MS);
      const isEnd = new Date(firstDate.getTime() + (startDay + isDays - 1) * DAY_MS);
      const oosStart = new Date(firstDate.getTime() + (startDay + isDays) * DAY_MS);
      const oosEnd = new Date(firstDate.getTime() + (startDay + isDays + oosDays - 1) * DAY_MS);
      const isBtc = sliceWindow(btc, isStart, isEnd);
      const oosBtc = sliceWindow(btc, oosStart, oosEnd);
      if (isBtc.length === 0 || oosBtc.length === 0) { r3idx++; continue; }
      const isOn = sliceWindow(onchain, onchain[0].date, isEnd);
      const oosOn = sliceWindow(onchain, onchain[0].date, oosEnd);
      const isDxy = sliceWindow(dxy, dxy[0]?.date ?? isStart, isEnd);
      const oosDxy = sliceWindow(dxy, dxy[0]?.date ?? oosStart, oosEnd);
      const isVix = sliceWindow(vix, vix[0]?.date ?? isStart, isEnd);
      const oosVix = sliceWindow(vix, vix[0]?.date ?? oosStart, oosEnd);

      let best: { params: R3Params; sharpe: number; mar: number; dd: number } | null = null;
      for (const params of r3Combos) {
        const r = runContinuousBacktest({
          btcBars: isBtc, onchainBars: isOn, dxyBars: isDxy, vixBars: isVix,
          params, initialCapital,
        });
        if (!best || normalizeSharpe(r.sharpe) > normalizeSharpe(best.sharpe)) {
          best = { params, sharpe: r.sharpe, mar: r.mar, dd: r.maxDrawdown };
        }
      }
      if (!best) { r3idx++; continue; }
      const oos = runContinuousBacktest({
        btcBars: oosBtc, onchainBars: oosOn, dxyBars: oosDxy, vixBars: oosVix,
        params: best.params, initialCapital,
      });
      r3Windows.push({
        isSharpe: safeKpi(best.sharpe, 999),
        oosSharpe: safeKpi(oos.sharpe, 999),
        oosMar: safeKpi(oos.mar, 999),
        oosMaxDd: oos.maxDrawdown,
      });
      r3idx++;
    }
    const r3Avg = avg(r3Windows.map(w => w.oosSharpe));
    const r3Dd = r3Windows.length ? Math.max(...r3Windows.map(w => w.oosMaxDd)) : 0;
    const r3Mar = avg(r3Windows.map(w => w.oosMar));
    const r3IsAvg = avg(r3Windows.map(w => w.isSharpe));
    const r3Drop = r3IsAvg > 0 ? (r3IsAvg - r3Avg) / r3IsAvg : 0;

    console.log(`Windows: ${r3Windows.length} | OOS Sharpe: ${r3Avg.toFixed(3)} | MAR: ${r3Mar.toFixed(3)} | Max DD: ${(r3Dd*100).toFixed(2)}% | drop: ${(r3Drop*100).toFixed(1)}%`);

    if (bh) {
      console.log(`\n=== BH benchmark (6.5y 2019-10 ~) ===\nSharpe: ${bh.sharpe.toFixed(3)} | MAR: ${bh.mar.toFixed(3)} | DD: ${(bh.maxDrawdown * 100).toFixed(2)}%`);
    }

    console.log(`\n=== Summary ===`);
    console.log(`BH 6.5y : Sharpe ${bh?.sharpe.toFixed(3)} | DD ${((bh?.maxDrawdown ?? 0)*100).toFixed(2)}%`);
    console.log(`R4d S3  : Sharpe ${r3Avg.toFixed(3)} | DD ${(r3Dd*100).toFixed(2)}% | drop ${(r3Drop*100).toFixed(1)}%`);
    console.log(`R5 v2   : Sharpe ${oosAvgSharpe.toFixed(3)} | DD ${(oosMaxDd*100).toFixed(2)}% | drop ${(drop*100).toFixed(1)}%`);

    const passed = oosAvgSharpe >= 1.0 && oosMaxDd <= 0.5 && drop <= 0.3 && (!bh || oosAvgSharpe > bh.sharpe);
    console.log(`\nStrict criteria (Sharpe ≥ 1.0 & DD ≤ 50% & drop ≤ 30% & beats BH): ${passed ? "PASS ★" : "FAIL"}`);

    await prisma.walkForwardRun.create({
      data: {
        strategy: "continuous-sizing-v2",
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
        windows: windows.map(w => ({
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
    const filepath = path.join(outDir, `continuous-sizing-v2-BTC-USD-${ts}.md`);
    const lines: string[] = [
      `# Walk-Forward Report: Continuous Sizing v2 (4-signal, BTC-USD)`,
      ``,
      `**Period:** ${start.format("YYYY-MM-DD")} – ${end.format("YYYY-MM-DD")} (6.5y, funding data limited)`,
      `**Signals:** Onchain + DXY + VIX + Funding Rate`,
      `**Windows:** ${windows.length}`,
      `**Robustness:** ${passed ? "PASS ★" : "FAIL"}`,
      ``,
      `## Comparison`,
      ``,
      `| Strategy | OOS Sharpe | OOS Max DD | IS→OOS Drop | Beats BH? |`,
      `|---|---|---|---|---|`,
      `| BH (6.5y baseline) | ${bh?.sharpe.toFixed(3)} | ${((bh?.maxDrawdown ?? 0)*100).toFixed(2)}% | — | baseline |`,
      `| R4d Step 3 (3-signal) | ${r3Avg.toFixed(3)} | ${(r3Dd*100).toFixed(2)}% | ${(r3Drop*100).toFixed(1)}% | ${bh && r3Avg > bh.sharpe ? "YES" : "NO"} |`,
      `| **R5 v2 (4-signal)** | **${oosAvgSharpe.toFixed(3)}** | **${(oosMaxDd*100).toFixed(2)}%** | **${(drop*100).toFixed(1)}%** | **${bh && oosAvgSharpe > bh.sharpe ? "YES ★" : "NO"}** |`,
      ``,
      `## R5 v2 OOS KPIs`,
      ``,
      `| Metric | Value |`,
      `|---|---|`,
      `| OOS Avg Sharpe | ${oosAvgSharpe.toFixed(3)} |`,
      `| OOS Avg MAR | ${oosAvgMar.toFixed(3)} |`,
      `| OOS Avg PF | ${oosAvgPf.toFixed(3)} |`,
      `| OOS Max DD | ${(oosMaxDd*100).toFixed(2)}% |`,
      `| OOS Avg Total Return | ${(oosAvgTotalReturn*100).toFixed(2)}% |`,
      `| IS->OOS Drop | ${(drop*100).toFixed(2)}% |`,
      ``,
      `## Parameter Grid`,
      ``,
    ];
    lines.push("```json", JSON.stringify(paramGrid, null, 2), "```");
    lines.push(``, `## Windows`, ``);
    lines.push(
      `| # | IS Period | OOS Period | Best Params | IS Sharpe | OOS Sharpe | OOS MAR | OOS PF | OOS DD |`,
      `|---|---|---|---|---|---|---|---|---|`,
    );
    for (const w of windows) {
      const ps = Object.entries(w.bestParams).map(([k,v]) => `${k}=${v}`).join(", ");
      lines.push(
        `| ${w.idx} | ${dayjs(w.isStart).format("YY-MM-DD")}->${dayjs(w.isEnd).format("YY-MM-DD")} | ${dayjs(w.oosStart).format("YY-MM-DD")}->${dayjs(w.oosEnd).format("YY-MM-DD")} | ${ps} | ${w.isSharpe.toFixed(2)} | ${w.oosSharpe.toFixed(2)} | ${w.oosMar.toFixed(2)} | ${w.oosPf.toFixed(2)} | ${(w.oosMaxDd*100).toFixed(1)}% |`,
      );
    }
    await fs.writeFile(filepath, lines.join("\n"), "utf-8");
    console.log(`\nReport: ${filepath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(e => { console.error(e); process.exitCode = 1; });
