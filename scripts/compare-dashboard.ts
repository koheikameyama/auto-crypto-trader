/**
 * Side-by-side virtual vs actual portfolio dashboard.
 * Actual rows from ActualPortfolioState (JPY, GMO spot).
 * Virtual rows from VirtualPortfolioState (USD, simulated).
 *
 * Asset arg matches ActualPortfolioState key ("BTC" or "ETH"). The matching
 * virtual row is looked up by asset + "-USD".
 *
 * Usage:
 *   npx tsx scripts/compare-dashboard.ts --asset=BTC --days=30
 */
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";

interface CliArgs {
  asset: "BTC" | "ETH";
  days: number;
}

function parseArgs(): CliArgs {
  let asset: CliArgs["asset"] = "BTC";
  let days = 30;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--asset=")) {
      const v = a.slice("--asset=".length);
      if (v === "BTC" || v === "ETH") asset = v;
      else throw new Error(`Unsupported asset: ${v}`);
    } else if (a.startsWith("--days=")) {
      days = Number(a.slice("--days=".length));
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return { asset, days };
}

async function main(): Promise<void> {
  const { asset, days } = parseArgs();
  const virtualKey = `${asset}-USD`;
  const prisma = new PrismaClient();
  try {
    const since = dayjs().subtract(days, "day").toDate();

    const virtualRows = await prisma.virtualPortfolioState.findMany({
      where: { asset: virtualKey, date: { gte: since } },
      orderBy: { date: "asc" },
    });
    const actualRows = await prisma.actualPortfolioState.findMany({
      where: { asset, date: { gte: since } },
      orderBy: { date: "asc" },
    });

    const virtualByDate = new Map(
      virtualRows.map((r) => [dayjs(r.date).format("YYYY-MM-DD"), r]),
    );
    const actualByDate = new Map(
      actualRows.map((r) => [dayjs(r.date).format("YYYY-MM-DD"), r]),
    );
    const dates = Array.from(
      new Set([...virtualByDate.keys(), ...actualByDate.keys()]),
    ).sort();

    if (dates.length === 0) {
      console.log(`No data for ${asset} in the last ${days} days.`);
      return;
    }

    console.log(
      `\n=== Compare (${asset}, last ${days} days) — Virtual (USD) vs Actual (JPY) ===\n`,
    );
    console.log(
      `| Date       | Target | V.CumRet | A.CumRet | Diff(pp) | V.Eq      | A.Eq       | Slip   | Reb(V/A) |`,
    );
    console.log(
      `|------------|--------|----------|----------|----------|-----------|------------|--------|----------|`,
    );

    let maxDiff = 0;
    for (const d of dates) {
      const v = virtualByDate.get(d);
      const a = actualByDate.get(d);
      const target = v?.targetPosition ?? a?.targetPosition ?? 0;
      const vRet = v?.cumulativeReturn;
      const aRet = a?.cumulativeReturn;
      const diff =
        vRet !== undefined && aRet !== undefined ? aRet - vRet : null;
      if (diff !== null) maxDiff = Math.max(maxDiff, Math.abs(diff));

      const row = [
        d,
        `${(target * 100).toFixed(1)}%`.padStart(6),
        vRet !== undefined
          ? `${vRet >= 0 ? "+" : ""}${(vRet * 100).toFixed(2)}%`.padStart(8)
          : "—".padStart(8),
        aRet !== undefined
          ? `${aRet >= 0 ? "+" : ""}${(aRet * 100).toFixed(2)}%`.padStart(8)
          : "—".padStart(8),
        diff !== null
          ? `${diff >= 0 ? "+" : ""}${(diff * 100).toFixed(2)}`.padStart(8)
          : "—".padStart(8),
        v ? `$${v.equityUsd.toFixed(2)}`.padStart(9) : "—".padStart(9),
        a ? `¥${Math.round(a.equityJpy).toLocaleString("ja-JP")}`.padStart(10) : "—".padStart(10),
        a ? `${a.slippageBps.toFixed(1)}bps`.padStart(6) : "—".padStart(6),
        `${v?.rebalancedToday ? "★" : "·"}/${a?.rebalancedToday ? "★" : "·"}`.padStart(8),
      ];
      console.log(`| ${row.join(" | ")} |`);
    }

    const vLast = virtualRows[virtualRows.length - 1];
    const aLast = actualRows[actualRows.length - 1];
    console.log(`\n=== Summary ===`);
    console.log(
      `Virtual return: ${vLast ? ((vLast.cumulativeReturn * 100).toFixed(2) + "%") : "—"}`,
    );
    console.log(
      `Actual return:  ${aLast ? ((aLast.cumulativeReturn * 100).toFixed(2) + "%") : "—"}`,
    );
    console.log(`Max daily divergence: ${(maxDiff * 100).toFixed(2)}pp`);
    if (aLast) {
      const slips = actualRows.map((r) => Math.abs(r.slippageBps));
      const avgSlip =
        slips.length > 0 ? slips.reduce((s, x) => s + x, 0) / slips.length : 0;
      const maxSlip = slips.length > 0 ? Math.max(...slips) : 0;
      console.log(`Slippage:  avg ${avgSlip.toFixed(1)}bps, max ${maxSlip.toFixed(1)}bps`);
      console.log(
        `Total fee: ¥${Math.round(aLast.cumulativeFeeJpy).toLocaleString("ja-JP")}`,
      );
    }
    console.log(
      `Rebalance count: virtual ${virtualRows.filter((r) => r.rebalancedToday).length}, actual ${actualRows.filter((r) => r.rebalancedToday).length}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
