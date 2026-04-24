/**
 * Daily data collection for future strategy exploration.
 *
 * Not required for Scheme E (live-rebalance.ts already fetches DXY / funding /
 * crypto prices). This script keeps the following series fresh so we can run
 * backtests on new strategies without a long re-backfill.
 *
 *   Source           Ticker          Table          Frequency
 *   ---------------  --------------  -------------  ----------
 *   yfinance (sidecar) ^VIX          MacroBar       daily
 *   yfinance (sidecar) ^TNX          MacroBar       daily
 *   yfinance (sidecar) GC=F (gold)   MacroBar       daily
 *   yfinance (sidecar) CL=F (oil)    MacroBar       daily
 *   CoinMetrics        btc           OnchainMetric  daily
 *   CoinGecko          BTC.D         MacroBar       daily (dominance %)
 *   Alternative.me     FGI           MacroBar       daily (fear & greed)
 *
 * Best-effort: a failure on one source logs and continues to the next.
 * Skips rows that already exist (@@unique on (ticker, date)).
 *
 * Usage:
 *   npx tsx scripts/daily-data-collection.ts [--days=30]
 */

import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import { fetchMacroDaily } from "../src/data/macro-loader.js";
import { fetchOnchainDaily } from "../src/data/onchain-loader.js";

dayjs.extend(utc);

const YFINANCE_TICKERS = ["^VIX", "^TNX", "GC=F", "CL=F"] as const;

interface CliArgs {
  days: number;
}

function parseArgs(): CliArgs {
  let days = 30;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--days=")) {
      days = Number(a.slice("--days=".length));
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  if (!Number.isFinite(days) || days <= 0) {
    throw new Error(`Invalid days: ${days}`);
  }
  return { days };
}

interface ResultStat {
  source: string;
  ok: boolean;
  rowsAdded?: number;
  error?: string;
}

async function updateYfinance(
  prisma: PrismaClient,
  ticker: string,
  startIso: string,
  endIso: string,
): Promise<ResultStat> {
  try {
    const bars = await fetchMacroDaily(ticker, startIso, endIso);
    if (bars.length === 0) {
      return { source: ticker, ok: true, rowsAdded: 0 };
    }
    const result = await prisma.macroBar.createMany({
      data: bars.map((b) => ({
        ticker,
        date: b.date,
        open: b.open,
        high: b.high,
        low: b.low,
        close: b.close,
        volume: b.volume,
      })),
      skipDuplicates: true,
    });
    return { source: ticker, ok: true, rowsAdded: result.count };
  } catch (e) {
    return { source: ticker, ok: false, error: (e as Error).message };
  }
}

async function updateOnchain(
  prisma: PrismaClient,
  startIso: string,
  endIso: string,
): Promise<ResultStat> {
  try {
    const bars = await fetchOnchainDaily("BTC-USD", startIso, endIso);
    if (bars.length === 0) {
      return { source: "onchain-btc", ok: true, rowsAdded: 0 };
    }
    const asset = await prisma.asset.findUnique({
      where: { symbol: "BTC-USD" },
    });
    if (!asset) {
      return {
        source: "onchain-btc",
        ok: false,
        error: "BTC-USD asset row missing",
      };
    }
    const result = await prisma.onchainMetric.createMany({
      data: bars.map((b) => ({
        assetId: asset.id,
        date: b.date,
        priceUsd: b.priceUsd,
        capMrktUsd: b.capMrktUsd,
        txCnt: b.txCnt,
        adrActCnt: b.adrActCnt,
      })),
      skipDuplicates: true,
    });
    return { source: "onchain-btc", ok: true, rowsAdded: result.count };
  } catch (e) {
    return { source: "onchain-btc", ok: false, error: (e as Error).message };
  }
}

/**
 * CoinGecko /coins/{id}/market_chart?vs_currency=usd&days=N
 * Returns [[ts, market_cap], ...]. BTC market cap / total crypto market cap = dominance.
 * We fetch global metrics snapshot via /global instead — single data point per call,
 * but we only need today's bar (past days we forward-fill).
 *
 * Free tier rate limit: 30 req/min. One call per day is fine.
 */
async function updateBtcDominance(
  prisma: PrismaClient,
  today: Date,
): Promise<ResultStat> {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/global");
    if (!res.ok) {
      return {
        source: "BTC.D",
        ok: false,
        error: `HTTP ${res.status}`,
      };
    }
    const body = (await res.json()) as {
      data?: { market_cap_percentage?: { btc?: number } };
    };
    const dom = body.data?.market_cap_percentage?.btc;
    if (typeof dom !== "number") {
      return {
        source: "BTC.D",
        ok: false,
        error: "dominance not found in response",
      };
    }
    await prisma.macroBar.upsert({
      where: { ticker_date: { ticker: "BTC.D", date: today } },
      create: {
        ticker: "BTC.D",
        date: today,
        open: dom,
        high: dom,
        low: dom,
        close: dom,
      },
      update: {
        open: dom,
        high: dom,
        low: dom,
        close: dom,
      },
    });
    return { source: "BTC.D", ok: true, rowsAdded: 1 };
  } catch (e) {
    return { source: "BTC.D", ok: false, error: (e as Error).message };
  }
}

/**
 * Alternative.me Fear & Greed Index.
 * Endpoint: https://api.alternative.me/fng/?limit={N}
 * Returns historical daily values (0..100).
 */
async function updateFearGreed(
  prisma: PrismaClient,
  days: number,
): Promise<ResultStat> {
  try {
    const res = await fetch(
      `https://api.alternative.me/fng/?limit=${days}`,
    );
    if (!res.ok) {
      return { source: "FGI", ok: false, error: `HTTP ${res.status}` };
    }
    const body = (await res.json()) as {
      data?: Array<{ value: string; timestamp: string }>;
    };
    const data = body.data ?? [];
    if (data.length === 0) {
      return { source: "FGI", ok: true, rowsAdded: 0 };
    }
    let added = 0;
    for (const d of data) {
      const value = Number(d.value);
      const date = new Date(Number(d.timestamp) * 1000);
      date.setUTCHours(0, 0, 0, 0);
      await prisma.macroBar.upsert({
        where: { ticker_date: { ticker: "FGI", date } },
        create: {
          ticker: "FGI",
          date,
          open: value,
          high: value,
          low: value,
          close: value,
        },
        update: {
          open: value,
          high: value,
          low: value,
          close: value,
        },
      });
      added += 1;
    }
    return { source: "FGI", ok: true, rowsAdded: added };
  } catch (e) {
    return { source: "FGI", ok: false, error: (e as Error).message };
  }
}

async function main(): Promise<void> {
  const { days } = parseArgs();
  const prisma = new PrismaClient();
  try {
    const now = dayjs().utc();
    const todayDateStr = now.format("YYYY-MM-DD");
    const today = new Date(`${todayDateStr}T00:00:00Z`);
    const startIso = now.subtract(days, "day").format("YYYY-MM-DD");
    const endIso = now.format("YYYY-MM-DD");

    console.log(
      `\n=== Daily Data Collection: ${startIso} → ${endIso} ===\n`,
    );

    const results: ResultStat[] = [];

    for (const ticker of YFINANCE_TICKERS) {
      const r = await updateYfinance(prisma, ticker, startIso, endIso);
      results.push(r);
      const status = r.ok ? `+${r.rowsAdded ?? 0} rows` : `FAIL: ${r.error}`;
      console.log(`${r.ok ? "✓" : "✗"} ${r.source.padEnd(12)} ${status}`);
    }

    {
      const r = await updateOnchain(prisma, startIso, endIso);
      results.push(r);
      const status = r.ok ? `+${r.rowsAdded ?? 0} rows` : `FAIL: ${r.error}`;
      console.log(`${r.ok ? "✓" : "✗"} ${r.source.padEnd(12)} ${status}`);
    }

    {
      const r = await updateBtcDominance(prisma, today);
      results.push(r);
      const status = r.ok ? `+${r.rowsAdded ?? 0} rows` : `FAIL: ${r.error}`;
      console.log(`${r.ok ? "✓" : "✗"} ${r.source.padEnd(12)} ${status}`);
    }

    {
      const r = await updateFearGreed(prisma, days);
      results.push(r);
      const status = r.ok ? `+${r.rowsAdded ?? 0} rows` : `FAIL: ${r.error}`;
      console.log(`${r.ok ? "✓" : "✗"} ${r.source.padEnd(12)} ${status}`);
    }

    const failed = results.filter((r) => !r.ok);
    console.log(
      `\n=== Summary: ${results.length - failed.length}/${results.length} OK ===`,
    );
    if (failed.length > 0) {
      console.log("Failures:");
      for (const r of failed) {
        console.log(`  ${r.source}: ${r.error}`);
      }
      // Exit 1 if all failed, else 0 (best-effort)
      if (failed.length === results.length) {
        process.exitCode = 1;
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
