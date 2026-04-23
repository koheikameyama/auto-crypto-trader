import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { donchianStrategy } from "../src/core/donchian/index.js";
import { ASSETS } from "../src/types/asset.js";
import { runBacktest } from "../src/backtest/engine.js";
import { loadBars } from "../src/backtest/runner-helpers.js";

async function main() {
  const prisma = new PrismaClient();
  try {
    const end = dayjs();
    const start = end.subtract(10, "year");
    const fundingRates = [0, 0.05, 0.1];

    console.log(`\n========================================`);
    console.log(`Funding Sensitivity: Donchian default params`);
    console.log(
      `Period: ${start.format("YYYY-MM-DD")} → ${end.format("YYYY-MM-DD")} (10y)`,
    );
    console.log(`========================================\n`);

    console.log(
      `| Asset | Funding | Sharpe | MAR | PF | DD | TotalRet | Trades |`,
    );
    console.log(`|---|---|---|---|---|---|---|---|`);

    for (const asset of ASSETS) {
      const bars = await loadBars(prisma, asset, start.toDate(), end.toDate());
      for (const fr of fundingRates) {
        const r = runBacktest({
          bars,
          asset,
          strategy: donchianStrategy,
          params: donchianStrategy.defaultParams,
          initialCapital: 10_000,
          riskRatio: 0.01,
          annualFundingRate: fr,
        });
        console.log(
          `| ${asset} | ${(fr * 100).toFixed(0)}% | ${r.sharpe.toFixed(3)} | ${r.mar.toFixed(3)} | ${r.profitFactor.toFixed(3)} | ${(r.maxDrawdown * 100).toFixed(2)}% | ${(r.totalReturn * 100).toFixed(1)}% | ${r.tradeCount} |`,
        );
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
