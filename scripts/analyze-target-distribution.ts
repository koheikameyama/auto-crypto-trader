/**
 * Recompute Scheme E target trajectory across all available history (DB-cached
 * DXY + funding + BTC/ETH price) and report distribution stats.
 *
 * Usage: npx tsx scripts/analyze-target-distribution.ts [--asset=BTC-USD]
 */
import { PrismaClient } from "@prisma/client";
import { computeLiveSignal } from "../src/live/signal-computer.js";
import type { DailyBar } from "../src/types/bar.js";
import type { FundingBar } from "../src/data/funding-loader.js";

function parseArgs(): { asset: "BTC-USD" | "ETH-USD" } {
  const arg = process.argv.find((a) => a.startsWith("--asset="));
  const v = arg ? arg.slice("--asset=".length) : "BTC-USD";
  if (v !== "BTC-USD" && v !== "ETH-USD") throw new Error(`Bad asset: ${v}`);
  return { asset: v };
}

async function main() {
  const { asset } = parseArgs();
  const fundingSymbol = asset === "BTC-USD" ? "BTCUSDT" : "ETHUSDT";
  const prisma = new PrismaClient();
  try {
    const dxyRows = await prisma.macroBar.findMany({
      where: { ticker: "DX-Y.NYB" },
      orderBy: { date: "asc" },
    });
    const dxyBars: DailyBar[] = dxyRows.map((r) => ({
      date: r.date, open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
    }));

    const fundRows = await prisma.fundingRate.findMany({
      where: { symbol: fundingSymbol },
      orderBy: { date: "asc" },
    });
    const fundingBars: FundingBar[] = fundRows.map((r) => ({
      date: r.date, avgRate: r.avgRate, count: r.count,
    }));

    if (dxyBars.length === 0 || fundingBars.length === 0) {
      throw new Error(`No data: dxy=${dxyBars.length}, funding=${fundingBars.length}`);
    }

    // Eval grid: each funding bar date (BTC/ETH 24-7), starting after lookback warmup
    const start = fundingBars[365]?.date ?? fundingBars[0].date;
    const end = fundingBars[fundingBars.length - 1].date;

    const targets: { date: Date; target: number; dxyScore: number; fundingScore: number }[] = [];
    for (const fb of fundingBars) {
      if (fb.date < start) continue;
      const sig = computeLiveSignal({
        dxyBars, fundingBars, today: fb.date,
        wDxy: 0.60, wFunding: 0.40,
        dxySmaPeriod: 200, fundingLookback: 365,
      });
      targets.push({
        date: fb.date,
        target: sig.targetPosition,
        dxyScore: sig.dxyScore,
        fundingScore: sig.fundingScore,
      });
    }

    targets.sort((a, b) => a.date.getTime() - b.date.getTime());

    const n = targets.length;
    const mean = targets.reduce((s, t) => s + t.target, 0) / n;
    const sorted = targets.map((t) => t.target).slice().sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.floor(p * (n - 1))];

    const buckets = [
      { label: "< 0.20", count: targets.filter((t) => t.target < 0.20).length },
      { label: "0.20-0.30", count: targets.filter((t) => t.target >= 0.20 && t.target < 0.30).length },
      { label: "0.30-0.40", count: targets.filter((t) => t.target >= 0.30 && t.target < 0.40).length },
      { label: "0.40-0.50", count: targets.filter((t) => t.target >= 0.40 && t.target < 0.50).length },
      { label: "0.50-0.60", count: targets.filter((t) => t.target >= 0.50 && t.target < 0.60).length },
      { label: "0.60-0.70", count: targets.filter((t) => t.target >= 0.60 && t.target < 0.70).length },
      { label: "0.70-0.80", count: targets.filter((t) => t.target >= 0.70 && t.target < 0.80).length },
      { label: "0.80-0.90", count: targets.filter((t) => t.target >= 0.80 && t.target < 0.90).length },
      { label: ">= 0.90", count: targets.filter((t) => t.target >= 0.90).length },
    ];

    const fmtDate = (d: Date) => d.toISOString().slice(0, 10);
    console.log(`\n=== Target distribution (${asset}, ${fmtDate(targets[0].date)} → ${fmtDate(targets[n - 1].date)}, ${n} days) ===\n`);
    console.log(`Mean:    ${mean.toFixed(3)}`);
    console.log(`Median:  ${pct(0.5).toFixed(3)}`);
    console.log(`P10/P25/P75/P90: ${pct(0.1).toFixed(3)} / ${pct(0.25).toFixed(3)} / ${pct(0.75).toFixed(3)} / ${pct(0.9).toFixed(3)}`);
    console.log(`Min/Max: ${sorted[0].toFixed(3)} / ${sorted[n - 1].toFixed(3)}`);

    console.log(`\n--- Histogram ---`);
    for (const b of buckets) {
      const pctOfTotal = (b.count / n) * 100;
      const bar = "█".repeat(Math.floor(pctOfTotal / 2));
      console.log(`${b.label.padEnd(10)} ${b.count.toString().padStart(5)} (${pctOfTotal.toFixed(1)}%)  ${bar}`);
    }

    console.log(`\n--- "SELL trigger candidates" (target < 0.50) ---`);
    const lowDays = targets.filter((t) => t.target < 0.50);
    console.log(`Total days: ${lowDays.length} (${((lowDays.length / n) * 100).toFixed(1)}% of history)`);

    if (lowDays.length > 0) {
      // Group into runs of consecutive < 0.50 days
      const runs: { start: Date; end: Date; minTarget: number; days: number }[] = [];
      let runStart = lowDays[0].date;
      let runMin = lowDays[0].target;
      let prev = lowDays[0].date;
      for (let i = 1; i < lowDays.length; i++) {
        const cur = lowDays[i];
        const dayDiff = (cur.date.getTime() - prev.getTime()) / 86400000;
        if (dayDiff > 1.5) {
          runs.push({ start: runStart, end: prev, minTarget: runMin, days: Math.round((prev.getTime() - runStart.getTime()) / 86400000) + 1 });
          runStart = cur.date;
          runMin = cur.target;
        } else {
          runMin = Math.min(runMin, cur.target);
        }
        prev = cur.date;
      }
      runs.push({ start: runStart, end: prev, minTarget: runMin, days: Math.round((prev.getTime() - runStart.getTime()) / 86400000) + 1 });

      console.log(`Episodes: ${runs.length}`);
      console.log(`\n| Start      | End        | Days | Min target |`);
      console.log(`|------------|------------|------|------------|`);
      for (const r of runs) {
        console.log(`| ${fmtDate(r.start)} | ${fmtDate(r.end)} | ${r.days.toString().padStart(4)} | ${r.minTarget.toFixed(3)}      |`);
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
