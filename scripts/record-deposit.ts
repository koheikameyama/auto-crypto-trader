/**
 * Record a JPY deposit / withdrawal event so the daily live-execute can pick
 * it up automatically (no --deposit-jpy CLI needed at run-time).
 *
 * Idempotent by (asset, date) — re-running with the same date overwrites the
 * recorded amount.
 *
 * Usage:
 *   npx tsx scripts/record-deposit.ts --asset=BTC --date=2026-08-15 --amount=200000
 *   npx tsx scripts/record-deposit.ts --asset=BTC --date=2026-04-26 --amount=30000 --notes="Phase 2.1 Micro seed"
 *   npx tsx scripts/record-deposit.ts --asset=BTC --date=2026-05-13 --amount=70000 --notes="Phase 2.2 Small top-up"
 *
 *   # withdrawal: pass negative amount
 *   npx tsx scripts/record-deposit.ts --asset=BTC --date=2026-09-01 --amount=-50000 --notes="profit take"
 */
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(utc);

interface CliArgs {
  asset: "BTC" | "ETH";
  date: string;
  amount: number;
  notes: string | null;
}

function parseArgs(): CliArgs {
  let asset: "BTC" | "ETH" | undefined;
  let date: string | undefined;
  let amount: number | undefined;
  let notes: string | null = null;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--asset=")) {
      const v = a.slice("--asset=".length);
      if (v === "BTC" || v === "ETH") asset = v;
      else throw new Error(`Unsupported asset: ${v}`);
    } else if (a.startsWith("--date=")) {
      date = a.slice("--date=".length);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new Error(`--date must be YYYY-MM-DD, got: ${date}`);
      }
    } else if (a.startsWith("--amount=")) {
      amount = Number(a.slice("--amount=".length));
      if (!Number.isFinite(amount)) {
        throw new Error(`--amount must be a finite number, got: ${a}`);
      }
    } else if (a.startsWith("--notes=")) {
      notes = a.slice("--notes=".length);
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!asset) throw new Error("--asset=BTC|ETH required");
  if (!date) throw new Error("--date=YYYY-MM-DD required");
  if (amount === undefined) throw new Error("--amount=N required");
  return { asset, date, amount, notes };
}

async function main(): Promise<void> {
  const { asset, date, amount, notes } = parseArgs();
  const prisma = new PrismaClient();
  try {
    const dateUtc = new Date(`${date}T00:00:00Z`);
    const event = await prisma.depositEvent.upsert({
      where: { asset_date: { asset, date: dateUtc } },
      create: { asset, date: dateUtc, amountJpy: amount, notes },
      update: { amountJpy: amount, notes },
    });
    const sign = amount >= 0 ? "+" : "";
    console.log(
      `Recorded DepositEvent: ${asset} ${date} ${sign}¥${amount.toLocaleString("ja-JP")}${notes ? ` (${notes})` : ""}`,
    );
    console.log(`  id=${event.id}`);
    console.log(
      `\nNext live-execute on ${date} will apply this automatically. To recompute past cumret, run scripts/backfill-deposit-jpy.ts --apply.`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
