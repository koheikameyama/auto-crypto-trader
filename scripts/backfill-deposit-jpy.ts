/**
 * Recompute ActualPortfolioState.cumulativeReturn and depositJpy from DepositEvent
 * in TWR order so historical capital injections stop showing up as profit
 * (e.g. Phase 2.1→2.2 +¥70,000 looked like +233% before the TWR fix).
 *
 * Reads deposits from DepositEvent (record them first via scripts/record-deposit.ts).
 *
 * Usage (dry-run by default):
 *   npx tsx scripts/backfill-deposit-jpy.ts --asset=BTC
 *   npx tsx scripts/backfill-deposit-jpy.ts --asset=BTC --apply
 */
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";

dayjs.extend(utc);

interface CliArgs {
  asset: "BTC" | "ETH";
  apply: boolean;
}

function parseArgs(): CliArgs {
  let asset: "BTC" | "ETH" = "BTC";
  let apply = false;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--asset=")) {
      const v = a.slice("--asset=".length);
      if (v === "BTC" || v === "ETH") asset = v;
      else throw new Error(`Unsupported asset: ${v}`);
    } else if (a === "--apply") {
      apply = true;
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return { asset, apply };
}

async function main(): Promise<void> {
  const { asset, apply } = parseArgs();
  const prisma = new PrismaClient();
  try {
    console.log(
      `\n=== Backfill cumulativeReturn (${asset}, ${apply ? "APPLY" : "DRY-RUN"}) ===\n`,
    );

    const deposits = await prisma.depositEvent.findMany({
      where: { asset },
      orderBy: { date: "asc" },
    });
    if (deposits.length === 0) {
      console.log(
        `No DepositEvent rows for ${asset}. Record them first with scripts/record-deposit.ts.`,
      );
      return;
    }
    console.log("Recorded deposits:");
    for (const d of deposits) {
      const dStr = dayjs(d.date).utc().format("YYYY-MM-DD");
      console.log(
        `  ${dStr}: ¥${d.amountJpy.toLocaleString("ja-JP")}${d.notes ? ` (${d.notes})` : ""}`,
      );
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

    const depositByDate = new Map(
      deposits.map((d) => [dayjs(d.date).utc().format("YYYY-MM-DD"), d.amountJpy]),
    );

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
      const dep =
        c.depositJpy !== 0 ? `¥${c.depositJpy.toLocaleString("ja-JP")}` : "—";
      console.log(
        `| ${c.date} | ¥${Math.round(c.equityJpy).toLocaleString("ja-JP").padStart(10)} | ${dep.padStart(8)} | ${(c.oldCumret * 100).toFixed(2).padStart(8)}% | ${(c.newCumret * 100).toFixed(2).padStart(8)}% | ${(delta * 100).toFixed(2).padStart(7)}pp |`,
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
