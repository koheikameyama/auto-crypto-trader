import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import {
  runPairBacktest,
  pairTradeDefaults,
  type PairBacktestResult,
} from "./pair-engine.js";
import { loadBars } from "./runner-helpers.js";

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

function formatKpi(r: PairBacktestResult): string {
  const sh = Number.isFinite(r.sharpe) ? r.sharpe.toFixed(3) : "∞";
  const mar = Number.isFinite(r.mar) ? r.mar.toFixed(3) : "∞";
  const pf = Number.isFinite(r.profitFactor) ? r.profitFactor.toFixed(3) : "∞";
  const dd = (r.maxDrawdown * 100).toFixed(2);
  const wr = (r.winRate * 100).toFixed(1);
  return `Sharpe: ${sh} | MAR: ${mar} | PF: ${pf} | DD: ${dd}% | Trades: ${r.tradeCount} | WR: ${wr}% | TotalRet: ${(r.totalReturn * 100).toFixed(1)}%`;
}

async function main() {
  const { years } = parseArgs();
  const prisma = new PrismaClient();
  try {
    const end = dayjs();
    const start = end.subtract(years, "year");
    const btcBars = await loadBars(
      prisma,
      "BTC-USD",
      start.toDate(),
      end.toDate(),
    );
    const ethBars = await loadBars(
      prisma,
      "ETH-USD",
      start.toDate(),
      end.toDate(),
    );

    console.log(`\n========================================`);
    console.log(`Pair Trade Backtest (BTC-USD / ETH-USD)`);
    console.log(
      `Period: ${start.format("YYYY-MM-DD")} → ${end.format("YYYY-MM-DD")} (${years}y)`,
    );
    console.log(
      `BTC bars: ${btcBars.length}, ETH bars: ${ethBars.length}`,
    );
    console.log(`Params: ${JSON.stringify(pairTradeDefaults)}`);
    console.log(`========================================\n`);

    const result = runPairBacktest({
      btcBars,
      ethBars,
      params: pairTradeDefaults,
      initialCapital: 10_000,
    });

    console.log(`=== pair-trade (default) ===`);
    console.log(formatKpi(result));

    const longs = result.trades.filter((t) => t.direction === "long-spread").length;
    const shorts = result.trades.filter((t) => t.direction === "short-spread").length;
    const meanRevert = result.trades.filter((t) => t.exitReason === "mean_revert").length;
    const stopZ = result.trades.filter((t) => t.exitReason === "stop_z").length;
    const time = result.trades.filter((t) => t.exitReason === "time").length;
    const eod = result.trades.filter((t) => t.exitReason === "end_of_data").length;
    console.log(`Directions: long-spread=${longs}, short-spread=${shorts}`);
    console.log(`Exit reasons: mean_revert=${meanRevert}, stop_z=${stopZ}, time=${time}, end_of_data=${eod}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
