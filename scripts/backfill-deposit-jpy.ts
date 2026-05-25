/**
 * Backfill ActualPortfolioState.depositJpy for historical capital injections,
 * then recompute every row's cumulativeReturn in TWR order so prior deposits
 * stop showing up as profit (e.g. Phase 2.1→2.2 +¥70,000 looked like +233%).
 *
 * Usage (dry-run prints planned changes, no writes):
 *   npx tsx scripts/backfill-deposit-jpy.ts \
 *     --asset=BTC \
 *     --deposit=2026-04-26:30000 \
 *     --deposit=2026-05-13:70000
 *
 *   ...then re-run with --apply to persist.
 */
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(utc);

interface DepositEntry {
  date: string;
  amount: number;
}

interface CliArgs {
  asset: "BTC" | "ETH";
  deposits: DepositEntry[];
  apply: boolean;
}

function parseArgs(): CliArgs {
  let asset: "BTC" | "ETH" = "BTC";
  const deposits: DepositEntry[] = [];
  let apply = false;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--asset=")) {
      const v = a.slice("--asset=".length);
      if (v === "BTC" || v === "ETH") asset = v;
      else throw new Error(`Unsupported asset: ${v}`);
    } else if (a.startsWith("--deposit=")) {
      const v = a.slice("--deposit=".length);
      const [date, amountStr] = v.split(":");
      if (!date || !amountStr) {
        throw new Error(`--deposit must be YYYY-MM-DD:amount, got: ${v}`);
      }
      const amount = Number(amountStr);
      if (!Number.isFinite(amount)) {
        throw new Error(`--deposit amount must be a finite number, got: ${v}`);
      }
      deposits.push({ date, amount });
    } else if (a === "--apply") {
      apply = true;
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (deposits.length === 0) {
    throw new Error("at least one --deposit=YYYY-MM-DD:amount required");
  }
  return { asset, deposits, apply };
}

async function main(): Promise<void> {
  const { asset, deposits, apply } = parseArgs();
  const prisma = new PrismaClient();
  try {
    console.log(
      `\n=== Backfill depositJpy + recompute cumulativeReturn (${asset}, ${apply ? "APPLY" : "DRY-RUN"}) ===\n`,
    );
    console.log("Planned deposits:");
    for (const d of deposits) {
      console.log(`  ${d.date}: ¥${d.amount.toLocaleString("ja-JP")}`);
    }
    console.log();

    const rows = await prisma.actualPortfolioState.findMany({
      where: { asset },
      orderBy: { date: "asc" },
    });
    if (rows.length === 0) {
      console.log(`No ActualPortfolioState rows for ${asset}`);
      return;
    }

    const depositByDate = new Map(deposits.map((d) => [d.date, d.amount]));

    interface Computed {
      id: string;
      date: string;
      equityJpy: number;
      depositJpy: number;
      oldCumret: number;
      newCumret: number;
    }
    const computed: Computed[] = [];
    let prevEquity = 0;
    let prevCumret = 0;
    for (const r of rows) {
      const dateStr = dayjs(r.date).utc().format("YYYY-MM-DD");
      const dep = depositByDate.get(dateStr) ?? 0;
      let newCumret: number;
      if (prevEquity <= 0) {
        newCumret = 0;
      } else {
        const dailyReturn = (r.equityJpy - dep - prevEquity) / prevEquity;
        newCumret = (1 + prevCumret) * (1 + dailyReturn) - 1;
      }
      computed.push({
        id: r.id,
        date: dateStr,
        equityJpy: r.equityJpy,
        depositJpy: dep,
        oldCumret: r.cumulativeReturn,
        newCumret,
      });
      prevEquity = r.equityJpy;
      prevCumret = newCumret;
    }

    console.log("| Date       | Equity      | Deposit  | Old cumret | New cumret | Δ        |");
    console.log("|------------|-------------|----------|------------|------------|----------|");
    for (const c of computed) {
      const delta = c.newCumret - c.oldCumret;
      const isInjection = c.depositJpy !== 0;
      console.log(
        `| ${c.date} | ¥${Math.round(c.equityJpy).toLocaleString("ja-JP").padStart(10)} | ${isInjection ? `¥${c.depositJpy.toLocaleString("ja-JP")}` : "—"}`.padEnd(48) +
          ` | ${(c.oldCumret * 100).toFixed(2).padStart(8)}% | ${(c.newCumret * 100).toFixed(2).padStart(8)}% | ${(delta * 100).toFixed(2).padStart(7)}pp |`,
      );
    }

    if (!apply) {
      console.log("\n(dry-run — re-run with --apply to persist)");
      return;
    }

    console.log("\nApplying...");
    let updated = 0;
    for (const c of computed) {
      await prisma.actualPortfolioState.update({
        where: { id: c.id },
        data: {
          depositJpy: c.depositJpy,
          cumulativeReturn: c.newCumret,
        },
      });
      updated++;
    }
    console.log(`Updated ${updated} rows.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
