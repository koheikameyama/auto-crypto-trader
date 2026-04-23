import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import fs from "node:fs/promises";
import path from "node:path";
import { loadBars } from "../src/backtest/runner-helpers.js";
import { runRegimeWalkForward } from "../src/walk-forward/regime-engine.js";
import { buyAndHold } from "../src/lib/buy-and-hold.js";
import type { OnchainBar } from "../src/data/onchain-loader.js";
import type { RegimeParams } from "../src/backtest/regime-engine.js";

async function loadOnchainBars(
  prisma: PrismaClient,
  startDate: Date,
  endDate: Date,
): Promise<OnchainBar[]> {
  const assetRow = await prisma.asset.findUnique({
    where: { symbol: "BTC-USD" },
  });
  if (!assetRow) throw new Error("Asset not found: BTC-USD");
  const rows = await prisma.onchainMetric.findMany({
    where: {
      assetId: assetRow.id,
      date: { gte: startDate, lte: endDate },
    },
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
    const startDate = start.toDate();
    const endDate = end.toDate();

    const btc = await loadBars(prisma, "BTC-USD", startDate, endDate);
    const onchain = await loadOnchainBars(prisma, startDate, endDate);

    console.log(`\n========================================`);
    console.log(`Walk-Forward: on-chain regime (BTC)`);
    console.log(
      `Period: ${start.format("YYYY-MM-DD")} -> ${end.format("YYYY-MM-DD")} (${years}y)`,
    );
    console.log(`BTC bars: ${btc.length}, Onchain: ${onchain.length}`);
    console.log(`IS/OOS/step: ${isDays}/${oosDays}/${stepDays} days`);
    console.log(`========================================`);

    const paramGrid: { [K in keyof RegimeParams]?: number[] } = {
      nvtLookback: [7, 14, 30],
      nvtPercentile: [0.5, 0.7, 0.85],
      aaLookback: [14, 30, 60],
    };
    const fixed: Partial<RegimeParams> = {
      aaMomentumThreshold: 1.0,
      percentileWindow: 365,
    };

    const agg = runRegimeWalkForward({
      btcBars: btc,
      onchainBars: onchain,
      paramGrid,
      fixed,
      isDays,
      oosDays,
      stepDays,
      initialCapital,
    });

    const bh = buyAndHold(btc);

    console.log(`\n=== Strategy: Regime (on-chain) ===`);
    console.log(
      `Windows: ${agg.windows.length} | OOS Sharpe avg: ${agg.oosAvgSharpe.toFixed(3)} | MAR avg: ${agg.oosAvgMar.toFixed(3)} | PF avg: ${agg.oosAvgPf.toFixed(3)} | Max DD: ${(agg.oosMaxDd * 100).toFixed(2)}% | IS->OOS drop: ${(agg.isOosSharpeDrop * 100).toFixed(1)}%`,
    );
    if (bh) {
      console.log(
        `\n=== Benchmark: BTC Buy & Hold (full period) ===`,
      );
      console.log(
        `Sharpe: ${bh.sharpe.toFixed(3)} | MAR: ${bh.mar.toFixed(3)} | TotalRet: ${(bh.totalReturn * 100).toFixed(1)}% | Max DD: ${(bh.maxDrawdown * 100).toFixed(2)}%`,
      );
      console.log(
        `Strategy beats BH on Sharpe: ${agg.oosAvgSharpe > bh.sharpe ? "YES" : "NO"} (${agg.oosAvgSharpe.toFixed(3)} vs ${bh.sharpe.toFixed(3)})`,
      );
    }

    const passed =
      agg.oosAvgSharpe >= 1.0 &&
      agg.oosAvgMar >= 0.5 &&
      agg.oosAvgPf >= 1.3 &&
      agg.oosMaxDd <= 0.3 &&
      agg.isOosSharpeDrop <= 0.3;

    await prisma.walkForwardRun.create({
      data: {
        strategy: "onchain-regime",
        assetSymbol: "BTC-USD",
        startDate,
        endDate,
        isDays,
        oosDays,
        stepDays,
        oosAvgSharpe: safeKpi(agg.oosAvgSharpe),
        oosAvgMar: safeKpi(agg.oosAvgMar),
        oosAvgPf: safeKpi(agg.oosAvgPf),
        oosMaxDd: safeKpi(agg.oosMaxDd),
        isOosSharpeDrop: safeKpi(agg.isOosSharpeDrop),
        passed,
        windows: agg.windows.map((w) => ({
          windowIndex: w.windowIndex,
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
          oosTrades: w.oosTrades,
          oosTotalReturn: safeKpi(w.oosTotalReturn),
        })),
      },
    });

    const outDir = "reports/walk-forward";
    await fs.mkdir(outDir, { recursive: true });
    const ts = dayjs().format("YYYYMMDD-HHmmss");
    const filepath = path.join(outDir, `onchain-regime-BTC-USD-${ts}.md`);
    const lines: string[] = [
      `# Walk-Forward Report: onchain-regime (BTC-USD)`,
      ``,
      `**Period:** ${start.format("YYYY-MM-DD")} – ${end.format("YYYY-MM-DD")}`,
      `**BTC bars:** ${btc.length} | **Onchain bars:** ${onchain.length}`,
      `**Windows:** ${agg.windows.length}`,
      `**IS/OOS/step:** ${isDays}/${oosDays}/${stepDays} days`,
      `**Robustness:** ${passed ? "PASS" : "FAIL"}`,
    ];
    if (bh) {
      lines.push(
        `**BH Sharpe (benchmark):** ${bh.sharpe.toFixed(3)} | Beats BH: ${agg.oosAvgSharpe > bh.sharpe ? "YES" : "NO"}`,
      );
    }
    lines.push(
      ``,
      `## Aggregate OOS KPIs`,
      ``,
      `| Metric | Value |`,
      `|---|---|`,
      `| OOS Avg Sharpe | ${agg.oosAvgSharpe.toFixed(3)} |`,
      `| OOS Avg MAR | ${agg.oosAvgMar.toFixed(3)} |`,
      `| OOS Avg PF | ${agg.oosAvgPf.toFixed(3)} |`,
      `| OOS Max DD | ${(agg.oosMaxDd * 100).toFixed(2)}% |`,
      `| OOS Avg Total Return | ${(agg.oosAvgTotalReturn * 100).toFixed(2)}% |`,
      `| IS->OOS Sharpe Drop | ${(agg.isOosSharpeDrop * 100).toFixed(2)}% |`,
    );
    if (bh) {
      lines.push(
        ``,
        `## Buy & Hold Benchmark (full period)`,
        ``,
        `| Metric | Value |`,
        `|---|---|`,
        `| BH Sharpe | ${bh.sharpe.toFixed(3)} |`,
        `| BH MAR | ${bh.mar.toFixed(3)} |`,
        `| BH Total Return | ${(bh.totalReturn * 100).toFixed(2)}% |`,
        `| BH Max DD | ${(bh.maxDrawdown * 100).toFixed(2)}% |`,
      );
    }
    lines.push(
      ``,
      `## Parameter Grid`,
      ``,
      "```json",
      JSON.stringify(paramGrid, null, 2),
      "```",
      ``,
      `## Fixed Parameters`,
      ``,
      "```json",
      JSON.stringify(fixed, null, 2),
      "```",
      ``,
      `## Windows`,
      ``,
      `| # | IS Period | OOS Period | Best Params | IS Sharpe | OOS Sharpe | OOS MAR | OOS PF | OOS DD | OOS Trades |`,
      `|---|---|---|---|---|---|---|---|---|---|`,
    );
    for (const w of agg.windows) {
      const ps = Object.entries(w.bestParams)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ");
      lines.push(
        `| ${w.windowIndex} | ${dayjs(w.isStart).format("YY-MM-DD")}->${dayjs(w.isEnd).format("YY-MM-DD")} | ${dayjs(w.oosStart).format("YY-MM-DD")}->${dayjs(w.oosEnd).format("YY-MM-DD")} | ${ps} | ${w.isSharpe.toFixed(2)} | ${w.oosSharpe.toFixed(2)} | ${w.oosMar.toFixed(2)} | ${w.oosPf.toFixed(2)} | ${(w.oosMaxDd * 100).toFixed(1)}% | ${w.oosTrades} |`,
      );
    }
    await fs.writeFile(filepath, lines.join("\n"), "utf-8");
    console.log(`\nReport: ${filepath}`);
  } finally {
    await prisma.$disconnect();
  }
}

function safeKpi(n: number, max = 999): number {
  if (Number.isNaN(n)) return 0;
  if (n === Infinity) return max;
  if (n === -Infinity) return -max;
  return n;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
