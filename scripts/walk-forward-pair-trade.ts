import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import fs from "node:fs/promises";
import path from "node:path";
import { loadBars } from "../src/backtest/runner-helpers.js";
import { runPairWalkForward } from "../src/walk-forward/pair-engine.js";
import { alignAndComputeSpread } from "../src/lib/spread.js";
import type { DailyBar } from "../src/types/bar.js";
import type { PairTradeParams } from "../src/backtest/pair-engine.js";

/** 片方にしかない日は捨て、両方揃う date の bars を返す (engine の align と同じ粒度) */
function alignBothBars(
  btc: DailyBar[],
  eth: DailyBar[],
): { btc: DailyBar[]; eth: DailyBar[] } {
  const common = alignAndComputeSpread(btc, eth).map((s) => s.date.getTime());
  const commonSet = new Set(common);
  const filterAlignedBtc = btc.filter((b) => commonSet.has(b.date.getTime()));
  const ethByTime = new Map<number, DailyBar>();
  for (const e of eth) ethByTime.set(e.date.getTime(), e);
  const filterAlignedEth = filterAlignedBtc.map(
    (b) => ethByTime.get(b.date.getTime())!,
  );
  return { btc: filterAlignedBtc, eth: filterAlignedEth };
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

    const btcRaw = await loadBars(prisma, "BTC-USD", startDate, endDate);
    const ethRaw = await loadBars(prisma, "ETH-USD", startDate, endDate);
    const { btc, eth } = alignBothBars(btcRaw, ethRaw);

    console.log(`\n========================================`);
    console.log(`Walk-Forward: pair-trade (BTC-USD / ETH-USD)`);
    console.log(
      `Period: ${start.format("YYYY-MM-DD")} -> ${end.format("YYYY-MM-DD")} (${years}y)`,
    );
    console.log(
      `Aligned bars: ${btc.length} (BTC ${btcRaw.length} / ETH ${ethRaw.length})`,
    );
    console.log(`IS/OOS/step: ${isDays}/${oosDays}/${stepDays} days`);
    console.log(`========================================`);

    const paramGrid: { [K in keyof PairTradeParams]?: number[] } = {
      lookback: [20, 30, 60],
      entryThreshold: [1.5, 2.0, 2.5],
      exitThreshold: [0.0, 0.5, 1.0],
    };
    const fixed: Partial<PairTradeParams> = {
      stopThreshold: 3.5,
      timeStopDays: 30,
    };

    const agg = runPairWalkForward({
      btcBars: btc,
      ethBars: eth,
      paramGrid,
      fixed,
      isDays,
      oosDays,
      stepDays,
      initialCapital,
    });

    console.log(
      `\nWindows: ${agg.windows.length} | OOS Sharpe avg: ${agg.oosAvgSharpe.toFixed(3)} | MAR avg: ${agg.oosAvgMar.toFixed(3)} | PF avg: ${agg.oosAvgPf.toFixed(3)} | Max DD: ${(agg.oosMaxDd * 100).toFixed(2)}% | IS->OOS drop: ${(agg.isOosSharpeDrop * 100).toFixed(1)}%`,
    );

    // Persist WalkForwardRun (reuse strategy column = "pair-trade")
    await prisma.walkForwardRun.create({
      data: {
        strategy: "pair-trade",
        assetSymbol: "BTC-ETH-SPREAD",
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
        passed:
          agg.oosAvgSharpe >= 1.0 &&
          agg.oosAvgMar >= 0.5 &&
          agg.oosAvgPf >= 1.3 &&
          agg.oosMaxDd <= 0.3 &&
          agg.isOosSharpeDrop <= 0.3,
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

    // Write report
    const outDir = "reports/walk-forward";
    await fs.mkdir(outDir, { recursive: true });
    const ts = dayjs().format("YYYYMMDD-HHmmss");
    const filepath = path.join(outDir, `pair-trade-BTC-ETH-${ts}.md`);
    const lines: string[] = [
      `# Walk-Forward Report: pair-trade (BTC-USD / ETH-USD)`,
      ``,
      `**Period:** ${start.format("YYYY-MM-DD")} – ${end.format("YYYY-MM-DD")}`,
      `**Aligned bars:** ${btc.length}`,
      `**Windows:** ${agg.windows.length}`,
      `**IS/OOS/step:** ${isDays}/${oosDays}/${stepDays} days`,
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
    ];
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
