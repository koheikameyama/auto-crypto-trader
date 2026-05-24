/**
 * Backfill CapitalEvent records for Phase 2.1 / 2.2 deposits, then recompute
 * cumulativeReturn on every existing ActualPortfolioState row so historical
 * Slack messages / dashboards align with the cost-basis formula.
 *
 * Idempotent: re-running won't create duplicate events (matched by
 * (asset, date, note)) and just recomputes returns.
 *
 * Usage:
 *   npx tsx scripts/backfill-capital-events.ts            # dry-run preview
 *   npx tsx scripts/backfill-capital-events.ts --apply    # actually write
 */
import { PrismaClient } from "@prisma/client";
import { computeCumulativeReturn } from "../src/live/execution-adapter.js";

interface SeedEvent {
  asset: string;
  date: Date;
  deltaJpy: number;
  note: string;
}

const SEED_EVENTS: SeedEvent[] = [
  {
    asset: "BTC",
    date: new Date("2026-04-26T00:00:00Z"),
    deltaJpy: 30_000,
    note: "Phase 2.1 Micro initial deposit",
  },
  {
    asset: "BTC",
    date: new Date("2026-05-12T00:00:00Z"),
    deltaJpy: 70_000,
    note: "Phase 2.2 Small top-up (¥30,000 → ¥100,000)",
  },
];

async function main() {
  const apply = process.argv.includes("--apply");
  const prisma = new PrismaClient();

  console.log(`\n=== Backfill capital events (${apply ? "APPLY" : "DRY-RUN"}) ===\n`);

  for (const ev of SEED_EVENTS) {
    const existing = await prisma.capitalEvent.findFirst({
      where: { asset: ev.asset, date: ev.date, note: ev.note },
    });
    if (existing) {
      console.log(
        `  [skip] ${ev.asset} ${ev.date.toISOString().slice(0, 10)} ¥${ev.deltaJpy.toLocaleString("ja-JP")} — already seeded`,
      );
      continue;
    }
    console.log(
      `  [seed] ${ev.asset} ${ev.date.toISOString().slice(0, 10)} ¥${ev.deltaJpy.toLocaleString("ja-JP")} — ${ev.note}`,
    );
    if (apply) {
      await prisma.capitalEvent.create({ data: ev });
    }
  }

  console.log("\n--- Recomputing cumulativeReturn ---");
  const assets = Array.from(new Set(SEED_EVENTS.map((e) => e.asset)));
  for (const asset of assets) {
    const states = await prisma.actualPortfolioState.findMany({
      where: { asset },
      orderBy: { date: "asc" },
    });
    if (states.length === 0) {
      console.log(`  [skip] ${asset}: no ActualPortfolioState rows`);
      continue;
    }
    let changed = 0;
    for (const s of states) {
      const newReturn = await computeCumulativeReturn(
        prisma,
        asset,
        s.date,
        s.equityJpy,
      );
      const delta = Math.abs(newReturn - s.cumulativeReturn);
      if (delta < 1e-9) continue;
      changed += 1;
      console.log(
        `  ${asset} ${s.date.toISOString().slice(0, 10)}: ${(s.cumulativeReturn * 100).toFixed(2)}% → ${(newReturn * 100).toFixed(2)}%  (equity ¥${Math.round(s.equityJpy).toLocaleString("ja-JP")})`,
      );
      if (apply) {
        await prisma.actualPortfolioState.update({
          where: { id: s.id },
          data: { cumulativeReturn: newReturn },
        });
      }
    }
    console.log(
      `  ${asset}: ${changed}/${states.length} rows ${apply ? "updated" : "would be updated"}`,
    );
  }

  await prisma.$disconnect();
  console.log(`\n${apply ? "Applied." : "Dry-run complete. Re-run with --apply to write."}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
