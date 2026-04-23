import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";

interface CliArgs {
  asset: "BTC-USD" | "ETH-USD";
  days: number;
}

function parseArgs(): CliArgs {
  let asset: CliArgs["asset"] = "BTC-USD";
  let days = 30;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--asset=")) {
      const v = a.slice("--asset=".length);
      if (v === "BTC-USD" || v === "ETH-USD") asset = v;
      else throw new Error(`Unsupported asset: ${v}`);
    } else if (a.startsWith("--days=")) {
      days = Number(a.slice("--days=".length));
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return { asset, days };
}

function posBar(position: number, width = 20): string {
  const filled = Math.round(position * width);
  return "[" + "█".repeat(filled) + "·".repeat(width - filled) + "]";
}

async function renderPortfolioView(prisma: PrismaClient, asset: string, days: number): Promise<boolean> {
  const since = dayjs().subtract(days, "day").toDate();
  const rows = await prisma.virtualPortfolioState.findMany({
    where: { asset, date: { gte: since } },
    orderBy: { date: "asc" },
  });
  if (rows.length === 0) return false;

  console.log(`\n=== Virtual Portfolio (${asset}, last ${days} days) ===\n`);
  console.log(
    `| Date       | Price   | Target | Actual | Equity    | CumRet  | DD    | Fee(day) | Reb |`,
  );
  console.log(
    `|------------|---------|--------|--------|-----------|---------|-------|----------|-----|`,
  );
  let peakEquity = 0;
  for (const r of rows) {
    const d = dayjs(r.date).format("YYYY-MM-DD");
    const price = r.price.toFixed(2).padStart(7);
    const target = `${(r.targetPosition * 100).toFixed(1)}%`.padStart(6);
    const actual = `${(r.actualPosition * 100).toFixed(1)}%`.padStart(6);
    const equity = r.equityUsd.toFixed(2).padStart(9);
    const cumRet = `${r.cumulativeReturn >= 0 ? "+" : ""}${(r.cumulativeReturn * 100).toFixed(2)}%`.padStart(7);
    if (r.equityUsd > peakEquity) peakEquity = r.equityUsd;
    const dd = peakEquity > 0 ? (peakEquity - r.equityUsd) / peakEquity : 0;
    const ddStr = `${(dd * 100).toFixed(1)}%`.padStart(5);
    const fee = `$${r.feeUsd.toFixed(2)}`.padStart(8);
    const reb = r.rebalancedToday ? "★" : "·";
    console.log(
      `| ${d} | ${price} | ${target} | ${actual} | ${equity} | ${cumRet} | ${ddStr} | ${fee} | ${reb.padStart(3)} |`,
    );
  }

  const last = rows[rows.length - 1];
  const first = rows[0];
  const maxDD = rows.reduce((m, r) => {
    const peakToHere = rows.slice(0, rows.indexOf(r) + 1).reduce((p, x) => Math.max(p, x.equityUsd), 0);
    const dd = peakToHere > 0 ? (peakToHere - r.equityUsd) / peakToHere : 0;
    return Math.max(m, dd);
  }, 0);
  const rebCount = rows.filter((r) => r.rebalancedToday).length;

  console.log(`\n=== Summary ===`);
  console.log(`Period:    ${dayjs(first.date).format("YYYY-MM-DD")} → ${dayjs(last.date).format("YYYY-MM-DD")} (${rows.length} days)`);
  console.log(`Initial:   ~$${(last.equityUsd / (1 + last.cumulativeReturn)).toFixed(2)}`);
  console.log(`Current:   $${last.equityUsd.toFixed(2)}`);
  console.log(`Return:    ${last.cumulativeReturn >= 0 ? "+" : ""}${(last.cumulativeReturn * 100).toFixed(2)}%`);
  console.log(`Max DD:    ${(maxDD * 100).toFixed(2)}%`);
  console.log(`Total fee: $${last.cumulativeFee.toFixed(2)}`);
  console.log(`Rebalances:${rebCount}`);
  console.log(`Target:    ${(last.targetPosition * 100).toFixed(1)}% long ${asset}`);
  return true;
}

async function main() {
  const { asset, days } = parseArgs();
  const prisma = new PrismaClient();
  try {
    // Try virtual portfolio first (has richer data)
    const hasPortfolio = await renderPortfolioView(prisma, asset, days);
    if (hasPortfolio) return;

    // Fallback: LivePositionLog (signal-only view)
    const since = dayjs().subtract(days, "day").toDate();
    const rows = await prisma.livePositionLog.findMany({
      where: { asset, date: { gte: since } },
      orderBy: { date: "asc" },
    });

    console.log(`\n=== Live Position Dashboard (${asset}, last ${days} days) ===\n`);
    if (rows.length === 0) {
      console.log(`No log entries yet. Run: npx tsx scripts/live-signal.ts --asset=${asset}`);
      return;
    }

    console.log(
      `| Date       | DXY    | DXYs | Fund% | Funds | Target     | Δ      | Reb |`,
    );
    console.log(
      `|------------|--------|------|-------|-------|------------|--------|-----|`,
    );
    for (const r of rows) {
      const d = dayjs(r.date).format("YYYY-MM-DD");
      const dxy = r.dxyValue.toFixed(2);
      const dxyS = r.dxyScore.toFixed(2);
      const fVal = (r.fundingValue * 100).toFixed(3);
      const fScore = r.fundingScore.toFixed(2);
      const target = r.targetPosition.toFixed(3);
      const delta =
        r.previousPosition !== null && r.previousPosition !== undefined
          ? `${((r.targetPosition - r.previousPosition) * 100).toFixed(1)}pp`
          : "—";
      const bar = posBar(r.targetPosition, 15);
      const reb = r.rebalanceFlag ? "★" : "·";
      console.log(
        `| ${d} | ${dxy.padStart(6)} | ${dxyS} | ${fVal.padStart(5)} | ${fScore} | ${bar} | ${delta.padStart(5)} | ${reb.padStart(3)} |`,
      );
    }

    // Summary
    const last = rows[rows.length - 1];
    const rebalances = rows.filter((r) => r.rebalanceFlag).length;
    console.log(`\n=== Summary ===`);
    console.log(`Latest date: ${dayjs(last.date).format("YYYY-MM-DD")}`);
    console.log(`Current target: ${(last.targetPosition * 100).toFixed(1)}% long ${asset}`);
    console.log(`Rebalances in last ${days}d: ${rebalances}`);
    const avgTarget = rows.reduce((a, b) => a + b.targetPosition, 0) / rows.length;
    console.log(`Avg target over window: ${(avgTarget * 100).toFixed(1)}%`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
