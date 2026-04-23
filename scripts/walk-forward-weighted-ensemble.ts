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
    priceUsd: r.priceUsd, capMrktUsd: r.capMrktUsd,
    txCnt: r.txCnt, adrActCnt: r.adrActCnt,
  }));
}

async function loadMacroBars(prisma: PrismaClient, ticker: string, s: Date, e: Date): Promise<DailyBar[]> {
  const rows = await prisma.macroBar.findMany({
    where: { ticker, date: { gte: s, lte: e } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({
    date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
  }));
}

async function loadFundingBars(prisma: PrismaClient, s: Date, e: Date): Promise<FundingBar[]> {
  const rows = await prisma.fundingRate.findMany({
    where: { symbol: "BTCUSDT", date: { gte: s, lte: e } },
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

interface WeightScheme {
  name: string;
  weights: Pick<WeightedParams, "wOnchain" | "wDxy" | "wVix" | "wFunding" | "wTnx">;
}

const SCHEMES: WeightScheme[] = [
  {
    name: "Equal-4 (R5 v2 baseline)",
    weights: { wOnchain: 0.25, wDxy: 0.25, wVix: 0.25, wFunding: 0.25, wTnx: 0.0 },
  },
  {
    name: "A: corr-based 5-sig",
    weights: { wOnchain: 0.15, wDxy: 0.40, wVix: 0.20, wFunding: 0.20, wTnx: 0.05 },
  },
  {
    name: "B: drop weak (3-sig: DXY-heavy)",
    weights: { wOnchain: 0.0, wDxy: 0.50, wVix: 0.25, wFunding: 0.25, wTnx: 0.0 },
  },
  {
    name: "C: drop onchain only (4-sig)",
    weights: { wOnchain: 0.0, wDxy: 0.35, wVix: 0.25, wFunding: 0.25, wTnx: 0.15 },
  },
  {
    name: "D: DXY dominant (3-sig)",
    weights: { wOnchain: 0.0, wDxy: 0.60, wVix: 0.20, wFunding: 0.20, wTnx: 0.0 },
  },
  {
    name: "E: DXY + funding pair",
    weights: { wOnchain: 0.0, wDxy: 0.60, wVix: 0.0, wFunding: 0.40, wTnx: 0.0 },
  },
];

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
    console.log(`Walk-Forward: Weighted Ensemble`);
    console.log(`Period: ${start.format("YYYY-MM-DD")} -> ${end.format("YYYY-MM-DD")} (6.5y)`);
    console.log(`BTC ${btc.length} / Onchain ${onchain.length} / DXY ${dxy.length} / VIX ${vix.length} / TNX ${tnx.length} / Funding ${funding.length}`);
    console.log(`========================================\n`);

    // Small grid on hyper-params; weights are tested as fixed schemes
    const hyperGrid = [
      { dxySmaPeriod: 100, vixThreshold: 30, rebalanceThreshold: 0.1 },
      { dxySmaPeriod: 200, vixThreshold: 30, rebalanceThreshold: 0.1 },
      { dxySmaPeriod: 200, vixThreshold: 30, rebalanceThreshold: 0.05 },
    ];

    const firstDate = btc[0].date;
    const lastDate = btc[btc.length - 1].date;
    const totalDays = Math.floor((lastDate.getTime() - firstDate.getTime()) / DAY_MS) + 1;

    interface SchemeResult {
      scheme: string;
      windows: number;
      oosAvgSharpe: number;
      oosAvgMar: number;
      oosMaxDd: number;
      isOosSharpeDrop: number;
    }
    const schemeResults: SchemeResult[] = [];

    for (const scheme of SCHEMES) {
      interface Window {
        isSharpe: number;
        oosSharpe: number;
        oosMar: number;
        oosMaxDd: number;
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

        // Optimize on hyper-grid with this scheme's weights fixed
        let best: { params: WeightedParams; result: WeightedResult } | null = null;
        for (const hp of hyperGrid) {
          const params: WeightedParams = {
            nvtLookback: 14, aaLookback: 30, percentileWindow: 365,
            dxySmaPeriod: hp.dxySmaPeriod,
            vixThreshold: hp.vixThreshold,
            fundingLookback: 365,
            tnxLookback: 365,
            rebalanceThreshold: hp.rebalanceThreshold,
            ...scheme.weights,
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
        if (!best) { idx++; continue; }

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
        idx++;
      }

      const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
      const oosAvgSharpe = avg(windows.map((w) => w.oosSharpe));
      const oosAvgMar = avg(windows.map((w) => w.oosMar));
      const oosMaxDd = windows.length ? Math.max(...windows.map((w) => w.oosMaxDd)) : 0;
      const isAvgSharpe = avg(windows.map((w) => w.isSharpe));
      const isOosSharpeDrop = isAvgSharpe > 0 ? (isAvgSharpe - oosAvgSharpe) / isAvgSharpe : 0;

      schemeResults.push({
        scheme: scheme.name,
        windows: windows.length,
        oosAvgSharpe,
        oosAvgMar,
        oosMaxDd,
        isOosSharpeDrop,
      });

      console.log(
        `${scheme.name.padEnd(32)} | Sharpe ${oosAvgSharpe.toFixed(3)} | MAR ${oosAvgMar.toFixed(3)} | DD ${(oosMaxDd * 100).toFixed(2)}% | drop ${(isOosSharpeDrop * 100).toFixed(1)}%`,
      );
    }

    const bh = buyAndHold(btc);
    console.log(`\n=== BH 6.5y ===\nSharpe ${bh?.sharpe.toFixed(3)} | DD ${((bh?.maxDrawdown ?? 0) * 100).toFixed(2)}%`);

    // Best scheme
    const best = schemeResults.reduce((a, b) => (a.oosAvgSharpe > b.oosAvgSharpe ? a : b));
    console.log(`\n=== BEST: ${best.scheme} ===`);
    console.log(`Sharpe ${best.oosAvgSharpe.toFixed(3)} | DD ${(best.oosMaxDd * 100).toFixed(2)}% | drop ${(best.isOosSharpeDrop * 100).toFixed(1)}%`);
    console.log(`Beats BH: ${bh && best.oosAvgSharpe > bh.sharpe ? "YES ★" : "NO"}`);
    const strictPass = best.oosAvgSharpe >= 1.0 && best.oosMaxDd <= 0.5 && best.isOosSharpeDrop <= 0.3 && !!bh && best.oosAvgSharpe > bh.sharpe;
    console.log(`Strict criteria (Sharpe ≥ 1.0 & DD ≤ 50% & drop ≤ 30% & beats BH): ${strictPass ? "PASS ★★" : "FAIL"}`);

    // Persist best scheme result
    await prisma.walkForwardRun.create({
      data: {
        strategy: `weighted-ensemble (${best.scheme})`,
        assetSymbol: "BTC-USD",
        startDate: start.toDate(), endDate: end.toDate(),
        isDays, oosDays, stepDays,
        oosAvgSharpe: safeKpi(best.oosAvgSharpe),
        oosAvgMar: safeKpi(best.oosAvgMar),
        oosAvgPf: 0,
        oosMaxDd: safeKpi(best.oosMaxDd),
        isOosSharpeDrop: safeKpi(best.isOosSharpeDrop),
        passed: strictPass,
        windows: JSON.parse(JSON.stringify(schemeResults)),
      },
    });

    // Report
    const outDir = "reports/walk-forward";
    await fs.mkdir(outDir, { recursive: true });
    const ts = dayjs().format("YYYYMMDD-HHmmss");
    const filepath = path.join(outDir, `weighted-ensemble-BTC-USD-${ts}.md`);
    const lines: string[] = [
      `# Walk-Forward Report: Weighted Ensemble (BTC-USD)`,
      ``,
      `**Period:** ${start.format("YYYY-MM-DD")} – ${end.format("YYYY-MM-DD")} (6.5y)`,
      `**Approach:** Test multiple weight schemes informed by signal correlation analysis`,
      ``,
      `## Weight Schemes Tested`,
      ``,
      `| Scheme | wOnchain | wDxy | wVix | wFunding | wTnx |`,
      `|---|---|---|---|---|---|`,
    ];
    for (const s of SCHEMES) {
      lines.push(
        `| ${s.name} | ${s.weights.wOnchain} | ${s.weights.wDxy} | ${s.weights.wVix} | ${s.weights.wFunding} | ${s.weights.wTnx} |`,
      );
    }
    lines.push(``, `## Results (OOS)`, ``);
    lines.push(`| Scheme | Sharpe | MAR | Max DD | IS→OOS Drop |`);
    lines.push(`|---|---|---|---|---|`);
    for (const r of schemeResults) {
      lines.push(
        `| ${r.scheme} | ${r.oosAvgSharpe.toFixed(3)} | ${r.oosAvgMar.toFixed(3)} | ${(r.oosMaxDd * 100).toFixed(2)}% | ${(r.isOosSharpeDrop * 100).toFixed(1)}% |`,
      );
    }
    if (bh) {
      lines.push(``, `## BH Benchmark`, ``);
      lines.push(`Sharpe ${bh.sharpe.toFixed(3)} | DD ${(bh.maxDrawdown * 100).toFixed(2)}%`);
    }
    lines.push(``, `## Best Scheme`, ``);
    lines.push(`- **Name:** ${best.scheme}`);
    lines.push(`- **Sharpe:** ${best.oosAvgSharpe.toFixed(3)}`);
    lines.push(`- **DD:** ${(best.oosMaxDd * 100).toFixed(2)}%`);
    lines.push(`- **Drop:** ${(best.isOosSharpeDrop * 100).toFixed(1)}%`);
    lines.push(`- **Beats BH:** ${bh && best.oosAvgSharpe > bh.sharpe ? "YES" : "NO"}`);
    lines.push(`- **Strict criteria pass:** ${strictPass ? "YES ★★" : "NO"}`);
    await fs.writeFile(filepath, lines.join("\n"), "utf-8");
    console.log(`\nReport: ${filepath}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
