import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import fs from "node:fs/promises";
import path from "node:path";
import { ASSETS } from "../src/types/asset.js";
import { runWalkForward, type WfAggregate } from "../src/walk-forward/engine.js";
import {
  checkRobustness,
  checkCrossAssetRobustness,
  defaultRobustness,
} from "../src/walk-forward/robustness.js";
import { loadBars } from "../src/backtest/runner-helpers.js";
import { buyAndHold, type BuyAndHoldResult } from "../src/lib/buy-and-hold.js";
import type { Strategy } from "../src/types/strategy.js";
import type { AssetSymbol } from "../src/types/asset.js";

export interface RunWfArgs {
  strategy: Strategy<Record<string, number>>;
  paramGrid: Record<string, number[]>;
  years?: number;
  isDays?: number;
  oosDays?: number;
  stepDays?: number;
  initialCapital?: number;
  riskRatio?: number;
  annualFundingRate?: number;
  reportDir?: string;
}

export async function runWfForAllAssets(args: RunWfArgs): Promise<void> {
  type P = Record<string, number>;
  const prisma = new PrismaClient();
  try {
    const years = args.years ?? 10;
    // 設計 §7: crypto は 365日/年、暦日ベースで定義
    const isDays = args.isDays ?? 365;
    const oosDays = args.oosDays ?? 182;
    const stepDays = args.stepDays ?? 182;
    const initialCapital = args.initialCapital ?? 10_000;
    const riskRatio = args.riskRatio ?? 0.01;
    const annualFundingRate = args.annualFundingRate ?? 0;
    const reportDir = args.reportDir ?? "reports/walk-forward";

    const end = dayjs();
    const start = end.subtract(years, "year");
    const startDate = start.toDate();
    const endDate = end.toDate();

    console.log(`\n========================================`);
    console.log(`Walk-Forward: ${args.strategy.name} (crypto)`);
    console.log(
      `Period: ${start.format("YYYY-MM-DD")} -> ${end.format("YYYY-MM-DD")} (${years}y)`,
    );
    console.log(`IS/OOS/step: ${isDays}/${oosDays}/${stepDays} days`);
    if (annualFundingRate !== 0) {
      console.log(`Funding rate: ${(annualFundingRate * 100).toFixed(1)}% p.a.`);
    }
    console.log(`========================================`);

    const perAsset: Partial<Record<AssetSymbol, WfAggregate<P>>> = {};
    const perAssetBh: Partial<Record<AssetSymbol, BuyAndHoldResult>> = {};
    const paramGridForDb: Record<string, number[]> = {};
    for (const k of Object.keys(args.paramGrid)) {
      paramGridForDb[k] = args.paramGrid[k];
    }

    for (const asset of ASSETS) {
      console.log(`\n--- ${asset} ---`);
      const bars = await loadBars(prisma, asset, startDate, endDate);
      console.log(`  loaded ${bars.length} bars`);
      if (bars.length < isDays + oosDays) {
        console.log(`  SKIP: not enough bars for WF (need ${isDays + oosDays})`);
        continue;
      }

      const bh = buyAndHold(bars);
      if (bh) {
        perAssetBh[asset] = bh;
        console.log(
          `  Buy & Hold: Sharpe ${bh.sharpe.toFixed(3)} | MAR ${bh.mar.toFixed(3)} | Ret ${(bh.totalReturn * 100).toFixed(1)}%`,
        );
      }

      const agg = runWalkForward({
        strategy: args.strategy,
        bars,
        asset,
        paramGrid: args.paramGrid,
        isDays,
        oosDays,
        stepDays,
        initialCapital,
        riskRatio,
        annualFundingRate,
      });
      perAsset[asset] = agg;
      console.log(
        `  WF Windows: ${agg.windows.length} | OOS Sharpe avg: ${agg.oosAvgSharpe.toFixed(3)} | MAR avg: ${agg.oosAvgMar.toFixed(3)} | PF avg: ${agg.oosAvgPf.toFixed(3)} | Max DD: ${(agg.oosMaxDd * 100).toFixed(2)}%`,
      );

      const check = checkRobustness(agg);
      const beatsBh = bh ? agg.oosAvgSharpe > bh.sharpe : null;
      if (bh) {
        console.log(
          `  Robustness: ${check.passed ? "PASS" : "FAIL"} | Beats BH: ${beatsBh ? "YES" : "NO"} (${agg.oosAvgSharpe.toFixed(3)} vs ${bh.sharpe.toFixed(3)})`,
        );
      }

      await prisma.walkForwardRun.create({
        data: {
          strategy: args.strategy.name,
          assetSymbol: asset,
          startDate,
          endDate,
          isDays,
          oosDays,
          stepDays,
          oosAvgSharpe: clampForDb(agg.oosAvgSharpe),
          oosAvgMar: clampForDb(agg.oosAvgMar),
          oosAvgPf: clampForDb(agg.oosAvgPf),
          oosMaxDd: clampForDb(agg.oosMaxDd),
          isOosSharpeDrop: clampForDb(agg.isOosSharpeDrop),
          passed: check.passed,
          windows: agg.windows.map((w) => ({
            windowIndex: w.windowIndex,
            isStart: w.isStart.toISOString(),
            isEnd: w.isEnd.toISOString(),
            oosStart: w.oosStart.toISOString(),
            oosEnd: w.oosEnd.toISOString(),
            bestParams: w.bestParams,
            isSharpe: clampForDb(w.isSharpe),
            oosSharpe: clampForDb(w.oosSharpe),
            oosMar: clampForDb(w.oosMar),
            oosPf: clampForDb(w.oosPf),
            oosMaxDd: clampForDb(w.oosMaxDd),
            oosTrades: w.oosTrades,
            oosTotalReturn: clampForDb(w.oosTotalReturn),
          })),
        },
      });

      await writeWfReport({
        reportDir,
        strategy: args.strategy.name,
        asset,
        agg,
        bh: bh ?? null,
        paramGrid: paramGridForDb,
        startDate,
        endDate,
        robustness: check,
      });
    }

    if (Object.keys(perAsset).length > 0) {
      const cross = checkCrossAssetRobustness(perAsset, defaultRobustness);
      console.log(`\n========================================`);
      console.log(`Cross-asset robustness: ${cross.passed ? "PASS" : "FAIL"}`);
      console.log(
        `Passing assets (${cross.passingAssets.length}/${Object.keys(perAsset).length}): ${cross.passingAssets.join(", ") || "(none)"}`,
      );
      console.log(`========================================\n`);
      for (const [asset, check] of Object.entries(cross.details)) {
        if (check && !check.passed) {
          console.log(`  ${asset} failed: ${check.reasons.join("; ")}`);
        }
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

function clampForDb(n: number, max = 999): number {
  if (Number.isNaN(n)) return 0;
  if (n === Infinity) return max;
  if (n === -Infinity) return -max;
  return n;
}

async function writeWfReport(args: {
  reportDir: string;
  strategy: string;
  asset: AssetSymbol;
  agg: WfAggregate<Record<string, number>>;
  bh: BuyAndHoldResult | null;
  paramGrid: Record<string, number[]>;
  startDate: Date;
  endDate: Date;
  robustness: { passed: boolean; reasons: string[] };
}): Promise<void> {
  await fs.mkdir(args.reportDir, { recursive: true });
  const ts = dayjs().format("YYYYMMDD-HHmmss");
  const filename = `${args.strategy}-${args.asset}-${ts}.md`;
  const filepath = path.join(args.reportDir, filename);
  const { agg, bh } = args;
  const beatsBh = bh ? agg.oosAvgSharpe > bh.sharpe : null;
  const lines: string[] = [
    `# Walk-Forward Report: ${args.strategy} / ${args.asset}`,
    ``,
    `**Period:** ${dayjs(args.startDate).format("YYYY-MM-DD")} - ${dayjs(args.endDate).format("YYYY-MM-DD")}`,
    `**Windows:** ${agg.windows.length}`,
    `**Robustness:** ${args.robustness.passed ? "PASS" : "FAIL"}`,
  ];
  if (bh) {
    lines.push(
      `**Buy & Hold Sharpe:** ${bh.sharpe.toFixed(3)} (strategy beats BH: ${beatsBh ? "YES" : "NO"})`,
    );
  }
  if (!args.robustness.passed) {
    lines.push(`**Failure reasons:**`);
    for (const r of args.robustness.reasons) lines.push(`- ${r}`);
  }
  lines.push(``, `## Aggregate OOS KPIs`, ``);
  lines.push(
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
      `## Buy & Hold Benchmark`,
      ``,
      `| Metric | Value |`,
      `|---|---|`,
      `| BH Sharpe | ${bh.sharpe.toFixed(3)} |`,
      `| BH MAR | ${bh.mar.toFixed(3)} |`,
      `| BH Total Return | ${(bh.totalReturn * 100).toFixed(2)}% |`,
      `| BH Annualized | ${(bh.annualReturn * 100).toFixed(2)}% |`,
      `| BH Max DD | ${(bh.maxDrawdown * 100).toFixed(2)}% |`,
    );
  }
  lines.push(
    ``,
    `## Parameter Grid`,
    ``,
    "```json",
    JSON.stringify(args.paramGrid, null, 2),
    "```",
  );
  lines.push(``, `## Windows`, ``);
  lines.push(
    `| # | IS Period | OOS Period | Best Params | IS Sharpe | OOS Sharpe | OOS MAR | OOS PF | OOS DD | OOS Trades |`,
    `|---|---|---|---|---|---|---|---|---|---|`,
  );
  for (const w of agg.windows) {
    const paramsStr = Object.entries(w.bestParams)
      .map(([k, v]) => `${k}=${v}`)
      .join(", ");
    lines.push(
      `| ${w.windowIndex} | ${dayjs(w.isStart).format("YY-MM-DD")}->${dayjs(w.isEnd).format("YY-MM-DD")} | ${dayjs(w.oosStart).format("YY-MM-DD")}->${dayjs(w.oosEnd).format("YY-MM-DD")} | ${paramsStr} | ${w.isSharpe.toFixed(2)} | ${w.oosSharpe.toFixed(2)} | ${w.oosMar.toFixed(2)} | ${w.oosPf.toFixed(2)} | ${(w.oosMaxDd * 100).toFixed(1)}% | ${w.oosTrades} |`,
    );
  }
  await fs.writeFile(filepath, lines.join("\n"), "utf-8");
  console.log(`  Report: ${filepath}`);
}
