/**
 * One-off backfill: insert the missing ETH ActualPortfolioState row for
 * 2026-07-29.
 *
 * Root cause (KOH-604): on 2026-07-29 the ETH maker SELL LIMIT never filled and
 * the old adapter threw on `!fill` instead of writing a carry row, so ETH had NO
 * row that day. The day therefore had only BTC (assetCount=1), and 2026-07-30's
 * portfolio cumret reconstructed prevTotalEquity from a single slice — halving
 * the account and spiking BTC cumret to +93%.
 *
 * This carries ETH forward from 2026-07-28 (no trade that day), mirroring what
 * `recordStateUnchanged` would have written. cumret is left as the 07-28 value
 * here; run `backfill-cumret.ts` afterwards to recompute the whole series.
 *
 * SAFETY: dry-run by default. Pass --apply to write.
 *
 *   npx tsx scripts/backfill-eth-2026-07-29.ts            # dry-run
 *   npx tsx scripts/backfill-eth-2026-07-29.ts --apply    # write
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const TARGET_DATE = "2026-07-29";
const PREV_DATE = "2026-07-28";

async function main() {
  const apply = process.argv.includes("--apply");

  const existing = await prisma.actualPortfolioState.findFirst({
    where: { asset: "ETH", date: new Date(`${TARGET_DATE}T00:00:00.000Z`) },
  });
  if (existing) {
    console.log(
      `ETH ${TARGET_DATE} row already exists (id=${existing.id}). Nothing to do.`,
    );
    await prisma.$disconnect();
    return;
  }

  const prev = await prisma.actualPortfolioState.findFirst({
    where: { asset: "ETH", date: new Date(`${PREV_DATE}T00:00:00.000Z`) },
  });
  if (!prev) {
    throw new Error(`ETH ${PREV_DATE} row not found — cannot carry forward.`);
  }

  // Target position for 07-29 comes from the virtual signal that day, if present;
  // otherwise carry the previous target. Purely informational (rebalancedToday
  // is false), so a fallback is safe.
  const virtual = await prisma.virtualPortfolioState.findFirst({
    where: { asset: "ETH-USD", date: new Date(`${TARGET_DATE}T00:00:00.000Z`) },
  });
  const targetPosition = virtual?.targetPosition ?? prev.targetPosition;

  const carry = {
    asset: "ETH",
    date: new Date(`${TARGET_DATE}T00:00:00.000Z`),
    price: prev.price,
    targetPosition,
    actualPosition: prev.actualPosition,
    cashJpy: prev.cashJpy,
    units: prev.units,
    equityJpy: prev.equityJpy,
    rebalancedToday: false,
    rebalanceDelta: 0,
    feeJpy: 0,
    slippageBps: 0,
    cumulativeReturn: prev.cumulativeReturn, // provisional; fixed by backfill-cumret
    cumulativeFeeJpy: prev.cumulativeFeeJpy,
    depositJpy: 0,
    skipReason: "backfill_no_fill: maker unfilled 2026-07-29 (KOH-604)",
  };

  console.log(`\n=== insert ETH ${TARGET_DATE} (${apply ? "APPLY" : "DRY-RUN"}) ===`);
  console.log(`  carry from ${PREV_DATE}:`);
  console.log(`    equityJpy   = ¥${Math.round(carry.equityJpy)}`);
  console.log(`    units       = ${carry.units}`);
  console.log(`    cashJpy     = ¥${Math.round(carry.cashJpy)}`);
  console.log(`    price       = ¥${Math.round(carry.price)}`);
  console.log(`    actualPos   = ${carry.actualPosition?.toFixed(4)}`);
  console.log(`    target      = ${(targetPosition * 100).toFixed(1)}%`);
  console.log(`    cumret(prov)= ${(carry.cumulativeReturn * 100).toFixed(2)}%`);

  if (!apply) {
    console.log("\nDRY-RUN: no row written. Re-run with --apply, then run backfill-cumret.ts.");
    await prisma.$disconnect();
    return;
  }

  const created = await prisma.actualPortfolioState.create({ data: carry });
  console.log(`\nAPPLIED: created ETH ${TARGET_DATE} row (id=${created.id}).`);
  console.log("Next: run `npx tsx scripts/backfill-cumret.ts --apply` to recompute cumret.");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
