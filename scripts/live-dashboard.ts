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

async function main() {
  const { asset, days } = parseArgs();
  const prisma = new PrismaClient();
  try {
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
