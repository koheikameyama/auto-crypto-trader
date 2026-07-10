/**
 * One-off backfill: repair the per-asset `cumulativeReturn` corruption caused by
 * the 2026-07 single→multi-asset (BTC→BTC+ETH) transition.
 *
 * Root cause: the per-asset equity slice is `weight × totalAccountEquity`. When
 * ETH went live the slice weight dropped 1.0→0.5, halving BTC's recorded equity
 * with no real P&L. The old TWR read that as a -50% one-day loss and every
 * subsequent day compounded on the corrupted baseline (BTC cumret stuck ~-52%).
 *
 * Fix: reconstruct the true WHOLE-account equity per day and recompute a single
 * portfolio-level cumret (identical for every asset that day), neutralizing the
 * reallocation. Mirrors `computePortfolioCumret` in execution-adapter.ts.
 *
 * SAFETY: dry-run by default (prints old→new, writes nothing). Pass --apply to
 * persist. Anchor = last clean single-asset day (2026-07-03), whose stored
 * cumret is correct and used as the compounding seed.
 *
 *   npx tsx scripts/backfill-cumret.ts                 # dry-run (default)
 *   npx tsx scripts/backfill-cumret.ts --apply         # write to DB
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ANCHOR = "2026-07-03"; // last clean single-asset (BTC-only) day
const CARRY_RE = /kill_switch|gmo_maintenance|consecutive/i;

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await prisma.actualPortfolioState.findMany({
    where: { date: { gte: new Date(`${ANCHOR}T00:00:00.000Z`) } },
    orderBy: [{ date: "asc" }, { asset: "asc" }],
  });

  // Group by calendar date.
  const byDate = new Map<string, typeof rows>();
  for (const r of rows) {
    const k = ymd(r.date);
    if (!byDate.has(k)) byDate.set(k, []);
    byDate.get(k)!.push(r);
  }
  const dates = [...byDate.keys()].sort();

  // Anchor: total equity + cumret of the clean single-asset day.
  const anchorRows = byDate.get(ANCHOR) ?? [];
  if (anchorRows.length !== 1) {
    throw new Error(
      `anchor ${ANCHOR} expected exactly 1 asset row, got ${anchorRows.length}`,
    );
  }
  let prevTotal = anchorRows[0].equityJpy;
  let prevCumret = anchorRows[0].cumulativeReturn;

  const deposits = await prisma.depositEvent.findMany({
    where: { date: { gt: new Date(`${ANCHOR}T00:00:00.000Z`) } },
  });
  const depByDate = new Map<string, number>();
  for (const d of deposits) {
    depByDate.set(ymd(d.date), (depByDate.get(ymd(d.date)) ?? 0) + d.amountJpy);
  }

  const plan: {
    date: string;
    total: number;
    newCumret: number;
    changes: { asset: string; id: string; old: number }[];
  }[] = [];

  for (const d of dates) {
    if (d === ANCHOR) continue;
    const dayRows = byDate.get(d)!;
    const n = dayRows.length;
    const weight = n > 0 ? 1 / n : 1;

    // Reconstruct total from FRESH rows only (a carried row holds a stale slice).
    const fresh = dayRows.filter((r) => !CARRY_RE.test(r.skipReason ?? ""));
    const candidates = fresh.map((r) => r.equityJpy / weight);
    const total =
      candidates.length > 0
        ? candidates.reduce((s, v) => s + v, 0) / candidates.length
        : prevTotal; // all assets carried → no valuation, hold total flat

    const dep = depByDate.get(d) ?? 0;
    const dailyReturn = (total - dep - prevTotal) / prevTotal;
    const newCumret = (1 + prevCumret) * (1 + dailyReturn) - 1;

    plan.push({
      date: d,
      total,
      newCumret,
      changes: dayRows.map((r) => ({
        asset: r.asset,
        id: r.id,
        old: r.cumulativeReturn,
      })),
    });

    prevTotal = total;
    prevCumret = newCumret;
  }

  console.log(`\n=== cumret backfill (${apply ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`anchor ${ANCHOR}: total ¥${prevTotalInit(anchorRows[0].equityJpy)} cumret ${(anchorRows[0].cumulativeReturn * 100).toFixed(2)}%\n`);
  console.log("date       | total_eq | new_cumret | BTC old→new        | ETH old→new");
  console.log("-".repeat(84));
  for (const p of plan) {
    const btc = p.changes.find((c) => c.asset === "BTC");
    const eth = p.changes.find((c) => c.asset === "ETH");
    const fmt = (c?: { old: number }) =>
      c
        ? `${(c.old * 100).toFixed(2)}%→${(p.newCumret * 100).toFixed(2)}%`
        : "—";
    console.log(
      `${p.date} | ${Math.round(p.total).toString().padStart(8)} | ${(p.newCumret * 100).toFixed(2).padStart(9)}% | ${fmt(btc).padEnd(18)} | ${fmt(eth)}`,
    );
  }

  if (!apply) {
    console.log("\nDRY-RUN: no rows written. Re-run with --apply to persist.");
    await prisma.$disconnect();
    return;
  }

  let updated = 0;
  for (const p of plan) {
    for (const c of p.changes) {
      await prisma.actualPortfolioState.update({
        where: { id: c.id },
        data: { cumulativeReturn: p.newCumret },
      });
      updated++;
    }
  }
  console.log(`\nAPPLIED: ${updated} rows updated.`);
  await prisma.$disconnect();
}

function prevTotalInit(v: number): string {
  return Math.round(v).toString();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
