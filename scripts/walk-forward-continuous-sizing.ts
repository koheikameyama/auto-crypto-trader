import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import fs from "node:fs/promises";
import path from "node:path";
import { loadBars } from "../src/backtest/runner-helpers.js";
import {
  runContinuousBacktest,
  type ContinuousParams,
  type ContinuousResult,
} from "../src/backtest/continuous-sizing-engine.js";
import { buyAndHold } from "../src/lib/buy-and-hold.js";
import type { OnchainBar } from "../src/data/onchain-loader.js";
import type { DailyBar } from "../src/types/bar.js";

const DAY_MS = 24 * 60 * 60 * 1000;

async function loadOnchainBars(
  prisma: PrismaClient,
  startDate: Date,
  endDate: Date,
): Promise<OnchainBar[]> {
  const a = await prisma.asset.findUnique({ where: { symbol: "BTC-USD" } });
  if (!a) throw new Error("Asset BTC-USD not found");
  const rows = await prisma.onchainMetric.findMany({
    where: { assetId: a.id, date: { gte: startDate, lte: endDate } },
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
  startDate: Date,
  endDate: Date,
): Promise<DailyBar[]> {
  const rows = await prisma.macroBar.findMany({
    where: { ticker, date: { gte: startDate, lte: endDate } },
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

function cartesian(
  grid: { [K in keyof ContinuousParams]?: number[] },
  fixed: Partial<ContinuousParams>,
): ContinuousParams[] {
  const keys = Object.keys(grid) as (keyof ContinuousParams)[];
  let combos: Array<Partial<ContinuousParams>> = [{ ...fixed }];
  for (const k of keys) {
    const values = grid[k]!;
    const next: Array<Partial<ContinuousParams>> = [];
    for (const c of combos) for (const v of values) next.push({ ...c, [k]: v });
    combos = next;
  }
  return combos as ContinuousParams[];
}

function sliceWindow<T extends { date: Date }>(
  bars: T[],
  startDate: Date,
  endDate: Date,
): T[] {
  return bars.filter((b) => b.date >= startDate && b.date <= endDate);
}

function normalizeSharpe(s: number): number {
  if (Number.isNaN(s)) return Number.NEGATIVE_INFINITY;
  if (s === Infinity) return Number.MAX_SAFE_INTEGER;
  if (s === -Infinity) return Number.NEGATIVE_INFINITY;
  return s;
}

function safeKpi(n: number, max = 10): number {
  if (Number.isNaN(n)) return 0;
  if (n === Infinity) return max;
  if (n === -Infinity) return -max;
  return n;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const years = 10;
    const isDays = 365;
    const oosDays = 182;
    const stepDays = 182;
    const initialCapital = 10_000;
    const end = dayjs();
    const start = end.subtract(years, "year");

    const btc = await loadBars(prisma, "BTC-USD", start.toDate(), end.toDate());
    const onchain = await loadOnchainBars(prisma, start.toDate(), end.toDate());
    const dxy = await loadMacroBars(prisma, "DX-Y.NYB", start.toDate(), end.toDate());
    const vix = await loadMacroBars(prisma, "^VIX", start.toDate(), end.toDate());

    console.log(`\n========================================`);
    console.log(`Walk-Forward: Continuous Sizing (BTC + onchain + DXY + VIX)`);
    console.log(`Period: ${start.format("YYYY-MM-DD")} -> ${end.format("YYYY-MM-DD")}`);
    console.log(`BTC ${btc.length} / Onchain ${onchain.length} / DXY ${dxy.length} / VIX ${vix.length}`);
    console.log(`========================================`);

    const paramGrid: { [K in keyof ContinuousParams]?: number[] } = {
      dxySmaPeriod: [100, 200],
      vixThreshold: [25, 30, 35],
      rebalanceThreshold: [0.05, 0.1, 0.2],
    };
    const fixed: Partial<ContinuousParams> = {
      nvtLookback: 14,
      aaLookback: 30,
      percentileWindow: 365,
    };
    const combos = cartesian(paramGrid, fixed);
    console.log(`Param combos: ${combos.length}`);

    // WF driver (inline for simplicity)
    const firstDate = btc[0].date;
    const lastDate = btc[btc.length - 1].date;
    const totalDays =
      Math.floor((lastDate.getTime() - firstDate.getTime()) / DAY_MS) + 1;

    interface Window {
      idx: number;
      isStart: Date;
      isEnd: Date;
      oosStart: Date;
      oosEnd: Date;
      bestParams: ContinuousParams;
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

      // Optimize IS
      let best: { params: ContinuousParams; result: ContinuousResult } | null = null;
      for (const params of combos) {
        const r = runContinuousBacktest({
          btcBars: isBtc,
          onchainBars: isOn,
          dxyBars: isDxy,
          vixBars: isVix,
          params,
          initialCapital,
        });
        if (!best || normalizeSharpe(r.sharpe) > normalizeSharpe(best.result.sharpe)) {
          best = { params, result: r };
        }
      }
      if (!best) { idx++; continue; }

      const oos = runContinuousBacktest({
        btcBars: oosBtc,
        onchainBars: oosOn,
        dxyBars: oosDxy,
        vixBars: oosVix,
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
        isSharpe: safeKpi(best.result.sharpe),
        oosSharpe: safeKpi(oos.sharpe),
        oosMar: safeKpi(oos.mar),
        oosPf: safeKpi(oos.profitFactor),
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
      `\nWindows: ${windows.length} | OOS Sharpe: ${oosAvgSharpe.toFixed(3)} | MAR: ${oosAvgMar.toFixed(3)} | PF: ${oosAvgPf.toFixed(3)} | Max DD: ${(oosMaxDd*100).toFixed(2)}% | drop: ${(drop*100).toFixed(1)}%`,
    );
    if (bh) {
      console.log(`\n=== BH benchmark ===\nSharpe: ${bh.sharpe.toFixed(3)} | DD: ${(bh.maxDrawdown * 100).toFixed(2)}%`);
      console.log(`Beats BH: ${oosAvgSharpe > bh.sharpe ? "YES" : "NO"}`);
    }

    const r4cSharpe = 0.684;
    const r4cDd = 0.4273;
    const beatsR4cSharpe = oosAvgSharpe > r4cSharpe;
    const beatsR4cDd = oosMaxDd < r4cDd;
    console.log(`\n=== Step 3 go/no-go vs R4c ===`);
    console.log(`Sharpe better: ${beatsR4cSharpe ? "YES" : "NO"} (${oosAvgSharpe.toFixed(3)} vs ${r4cSharpe})`);
    console.log(`DD better: ${beatsR4cDd ? "YES" : "NO"} (${(oosMaxDd*100).toFixed(2)}% vs ${(r4cDd*100).toFixed(2)}%)`);

    const passed =
      oosAvgSharpe >= 1.0 && oosMaxDd <= 0.5 && drop <= 0.3;
    console.log(`Strict criteria: ${passed ? "PASS" : "FAIL"}`);

    await prisma.walkForwardRun.create({
      data: {
        strategy: "continuous-sizing",
        assetSymbol: "BTC-USD",
        startDate: start.toDate(),
        endDate: end.toDate(),
        isDays,
        oosDays,
        stepDays,
        oosAvgSharpe: safeKpi(oosAvgSharpe, 999),
        oosAvgMar: safeKpi(oosAvgMar, 999),
        oosAvgPf: safeKpi(oosAvgPf, 999),
        oosMaxDd: safeKpi(oosMaxDd, 999),
        isOosSharpeDrop: safeKpi(drop, 999),
        passed,
        windows: windows.map(w => ({
          windowIndex: w.idx,
          isStart: w.isStart.toISOString(),
          isEnd: w.isEnd.toISOString(),
          oosStart: w.oosStart.toISOString(),
          oosEnd: w.oosEnd.toISOString(),
          bestParams: w.bestParams,
          isSharpe: safeKpi(w.isSharpe, 999),
          oosSharpe: safeKpi(w.oosSharpe, 999),
          oosMar: safeKpi(w.oosMar, 999),
          oosPf: safeKpi(w.oosPf, 999),
          oosMaxDd: safeKpi(w.oosMaxDd, 999),
          oosTrades: 0,
          oosTotalReturn: safeKpi(w.oosTotalReturn, 999),
        })),
      },
    });

    const outDir = "reports/walk-forward";
    await fs.mkdir(outDir, { recursive: true });
    const ts = dayjs().format("YYYYMMDD-HHmmss");
    const filepath = path.join(outDir, `continuous-sizing-BTC-USD-${ts}.md`);
    const lines: string[] = [
      `# Walk-Forward Report: Continuous Sizing (BTC-USD)`,
      ``,
      `**Period:** ${start.format("YYYY-MM-DD")} – ${end.format("YYYY-MM-DD")}`,
      `**Signals:** Onchain + DXY + VIX (soft-weighted)`,
      `**Windows:** ${windows.length}`,
      `**IS/OOS/step:** ${isDays}/${oosDays}/${stepDays}`,
      `**Robustness:** ${passed ? "PASS" : "FAIL"}`,
    ];
    if (bh) {
      lines.push(`**BH Sharpe:** ${bh.sharpe.toFixed(3)} | Beats BH: ${oosAvgSharpe > bh.sharpe ? "YES" : "NO"}`);
    }
    lines.push(
      ``,
      `## Aggregate OOS KPIs`,
      ``,
      `| Metric | Value |`,
      `|---|---|`,
      `| OOS Avg Sharpe | ${oosAvgSharpe.toFixed(3)} |`,
      `| OOS Avg MAR | ${oosAvgMar.toFixed(3)} |`,
      `| OOS Avg PF | ${oosAvgPf.toFixed(3)} |`,
      `| OOS Max DD | ${(oosMaxDd*100).toFixed(2)}% |`,
      `| OOS Avg Total Return | ${(oosAvgTotalReturn*100).toFixed(2)}% |`,
      `| IS->OOS Drop | ${(drop*100).toFixed(2)}% |`,
    );
    lines.push(``, `## Parameter Grid`, ``);
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
