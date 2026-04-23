import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import fs from "node:fs/promises";
import path from "node:path";
import { loadBars } from "../src/backtest/runner-helpers.js";
import { runTsbhWalkForward } from "../src/walk-forward/trailing-stop-bh-engine.js";
import { buyAndHold } from "../src/lib/buy-and-hold.js";
import type { TrailingStopBhParams } from "../src/backtest/trailing-stop-bh-engine.js";

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

    console.log(`\n========================================`);
    console.log(`Walk-Forward: Trailing Stop BH (BTC)`);
    console.log(
      `Period: ${start.format("YYYY-MM-DD")} -> ${end.format("YYYY-MM-DD")} (${years}y)`,
    );
    console.log(`BTC bars: ${btc.length}`);
    console.log(`IS/OOS/step: ${isDays}/${oosDays}/${stepDays} days`);
    console.log(`========================================`);

    const paramGrid: { [K in keyof TrailingStopBhParams]?: number[] } = {
      trailDrawdown: [20, 30, 40],
      reentryGain: [10, 20, 30],
    };

    const agg = runTsbhWalkForward({
      btcBars: btc,
      paramGrid,
      isDays,
      oosDays,
      stepDays,
      initialCapital,
    });
    const bh = buyAndHold(btc);

    console.log(
      `\nWindows: ${agg.windows.length} | OOS Sharpe: ${agg.oosAvgSharpe.toFixed(3)} | MAR: ${agg.oosAvgMar.toFixed(3)} | PF: ${agg.oosAvgPf.toFixed(3)} | Max DD: ${(agg.oosMaxDd * 100).toFixed(2)}% | drop: ${(agg.isOosSharpeDrop * 100).toFixed(1)}%`,
    );
    if (bh) {
      console.log(
        `\n=== BH benchmark ===\nSharpe: ${bh.sharpe.toFixed(3)} | MAR: ${bh.mar.toFixed(3)} | DD: ${(bh.maxDrawdown * 100).toFixed(2)}%`,
      );
      console.log(
        `Beats BH on Sharpe: ${agg.oosAvgSharpe > bh.sharpe ? "YES" : "NO"} (${agg.oosAvgSharpe.toFixed(3)} vs ${bh.sharpe.toFixed(3)})`,
      );
    }

    // Step 1 go/no-go judgment vs Round 4c
    const r4cSharpe = 0.684;
    const r4cDd = 0.4273;
    const beatsR4c =
      agg.oosAvgSharpe > r4cSharpe || agg.oosMaxDd < r4cDd;
    console.log(
      `\n=== Step 1 go/no-go vs R4c (Sharpe 0.684, DD 42.73%) ===`,
    );
    console.log(
      `Beats R4c on Sharpe OR DD: ${beatsR4c ? "YES → GO" : "NO → Step 2 へ"}`,
    );

    const passed =
      agg.oosAvgSharpe >= 1.0 &&
      agg.oosMaxDd <= 0.5 &&
      agg.isOosSharpeDrop <= 0.3;

    await prisma.walkForwardRun.create({
      data: {
        strategy: "trailing-stop-bh",
        assetSymbol: "BTC-USD",
        startDate: start.toDate(),
        endDate: end.toDate(),
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
    const filepath = path.join(outDir, `trailing-stop-bh-BTC-USD-${ts}.md`);
    const lines: string[] = [
      `# Walk-Forward Report: Trailing Stop BH (BTC-USD)`,
      ``,
      `**Period:** ${start.format("YYYY-MM-DD")} – ${end.format("YYYY-MM-DD")}`,
      `**Windows:** ${agg.windows.length}`,
      `**IS/OOS/step:** ${isDays}/${oosDays}/${stepDays}`,
      `**Robustness:** ${passed ? "PASS" : "FAIL"}`,
    ];
    if (bh) {
      lines.push(
        `**BH Sharpe:** ${bh.sharpe.toFixed(3)} | Beats BH: ${agg.oosAvgSharpe > bh.sharpe ? "YES" : "NO"}`,
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
        `## BH Benchmark (full 10y)`,
        ``,
        `| Metric | Value |`,
        `|---|---|`,
        `| BH Sharpe | ${bh.sharpe.toFixed(3)} |`,
        `| BH MAR | ${bh.mar.toFixed(3)} |`,
        `| BH Total Return | ${(bh.totalReturn * 100).toFixed(2)}% |`,
        `| BH Max DD | ${(bh.maxDrawdown * 100).toFixed(2)}% |`,
      );
    }
    lines.push(``, `## Parameter Grid`, ``);
    lines.push("```json", JSON.stringify(paramGrid, null, 2), "```");
    lines.push(``, `## Windows`, ``);
    lines.push(
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
