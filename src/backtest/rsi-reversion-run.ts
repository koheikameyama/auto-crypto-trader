import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { rsiReversionStrategy } from "../core/rsi-reversion/index.js";
import { ASSETS } from "../types/asset.js";
import { runAndPersist } from "./runner-helpers.js";

interface CliArgs {
  years: number;
}

function parseArgs(): CliArgs {
  let years = 10;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--years=")) {
      years = Number(a.slice("--years=".length));
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!Number.isFinite(years) || years <= 0) {
    throw new Error(`Invalid years: ${years}`);
  }
  return { years };
}

async function main() {
  const { years } = parseArgs();
  const prisma = new PrismaClient();
  try {
    const end = dayjs();
    const start = end.subtract(years, "year");
    console.log(`\n========================================`);
    console.log(`RSI Reversion Backtest (crypto)`);
    console.log(
      `Period: ${start.format("YYYY-MM-DD")} → ${end.format("YYYY-MM-DD")} (${years}y)`,
    );
    console.log(`========================================`);

    for (const asset of ASSETS) {
      await runAndPersist({
        prisma,
        strategy: rsiReversionStrategy,
        asset,
        params: rsiReversionStrategy.defaultParams,
        startDate: start.toDate(),
        endDate: end.toDate(),
        initialCapital: 10_000,
        riskRatio: 0.01,
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
