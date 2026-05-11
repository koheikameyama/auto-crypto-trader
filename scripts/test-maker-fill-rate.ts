/**
 * Round 12 — Maker LIMIT fill rate experiment.
 *
 * Runs N BTC minimum-lot round-trips (BUY then SELL) with a configurable
 * maker-wait window. For each LIMIT attempt records whether it filled,
 * how long it took, and the realized fee / slippage vs ref mid. Writes
 * OrderLog rows tagged `round_12_fill_rate` and a CSV report per batch.
 *
 * Does NOT touch ActualPortfolioState — Phase 2.1/2.2 ledger stays clean.
 *
 * Usage:
 *   npx tsx scripts/test-maker-fill-rate.ts --wait-sec=60 --count=5 --yes
 *   npx tsx scripts/test-maker-fill-rate.ts --wait-sec=300 --count=3 --offset-ticks=-1 --yes
 */

import { PrismaClient } from "@prisma/client";
import fs from "node:fs/promises";
import path from "node:path";
import { GmoApiError, GmoClient, type GmoSymbol } from "../src/live/gmo-client.js";

const SYMBOL: GmoSymbol = "BTC";
const SIZE = 0.0001;
const MARKET_WAIT_SEC = 10;
const TICK_YEN = 1; // BTC_JPY tick size at GMO
const SLEEP_BETWEEN_TRIPS_SEC = 10;
const TEST_TAG = "round_12_fill_rate";

interface Args {
  waitSec: number;
  count: number;
  offsetTicks: number;
  yes: boolean;
}

interface AttemptRecord {
  tripIdx: number;
  side: "BUY" | "SELL";
  refBid: number;
  refAsk: number;
  refMid: number;
  limitPrice: number;
  limitFilled: boolean;
  limitWaitMs: number;
  finalOrderType: "LIMIT" | "MARKET";
  execPrice: number;
  execUnits: number;
  feeJpy: number;
  slippageBps: number;
  ts: string;
}

interface FillResult {
  execPrice: number;
  execUnits: number;
  feeJpy: number;
  orderId: string;
  orderType: "LIMIT" | "MARKET";
  filledAt: Date;
  pollMs: number;
}

function parseArgs(): Args {
  let waitSec = 60;
  let count = 5;
  let offsetTicks = 0;
  let yes = false;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--wait-sec=")) waitSec = Number(a.slice("--wait-sec=".length));
    else if (a.startsWith("--count=")) count = Number(a.slice("--count=".length));
    else if (a.startsWith("--offset-ticks=")) offsetTicks = Number(a.slice("--offset-ticks=".length));
    else if (a === "--yes") yes = true;
    else throw new Error(`Unknown arg: ${a}`);
  }
  if (count < 1 || count > 5) throw new Error("count must be 1..5 (safety cap)");
  if (waitSec < 5 || waitSec > 600) throw new Error("wait-sec must be 5..600");
  return { waitSec, count, offsetTicks, yes };
}

const yen = (n: number): string =>
  `¥${n.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function logOrder(
  prisma: PrismaClient,
  input: {
    side: "BUY" | "SELL";
    orderType: "LIMIT" | "MARKET";
    requestedUnits: number;
    execUnits?: number;
    requestedPrice?: number;
    execPrice?: number;
    feeJpy?: number;
    orderId?: string;
    status: "submitted" | "filled" | "partial" | "failed" | "cancelled";
    note?: string;
    submittedAt: Date;
    filledAt?: Date;
  },
): Promise<void> {
  const tagged = input.note ? `${TEST_TAG}: ${input.note}` : TEST_TAG;
  await prisma.orderLog.create({
    data: {
      asset: SYMBOL,
      date: new Date(),
      side: input.side,
      orderType: input.orderType,
      requestedUnits: input.requestedUnits,
      execUnits: input.execUnits ?? null,
      requestedPrice: input.requestedPrice ?? null,
      execPrice: input.execPrice ?? null,
      feeJpy: input.feeJpy ?? null,
      orderId: input.orderId ?? null,
      status: input.status,
      errorMessage: tagged,
      submittedAt: input.submittedAt,
      filledAt: input.filledAt ?? null,
    },
  });
}

async function waitForFill(
  client: GmoClient,
  orderId: string,
  orderType: "LIMIT" | "MARKET",
  timeoutMs: number,
): Promise<FillResult | null> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  let interval = 500;
  while (Date.now() < deadline) {
    const execs = await client.getLatestExecutions(SYMBOL);
    const matches = execs.filter((e) => e.orderId === orderId);
    if (matches.length > 0) {
      const totalSize = matches.reduce((s, e) => s + e.size, 0);
      const weightedPrice =
        matches.reduce((s, e) => s + e.price * e.size, 0) / totalSize;
      const feeJpy = matches.reduce((s, e) => s + e.fee, 0);
      const last = matches[matches.length - 1];
      return {
        execPrice: weightedPrice,
        execUnits: totalSize,
        feeJpy,
        orderId,
        orderType,
        filledAt: new Date(last?.timestamp ?? Date.now()),
        pollMs: Date.now() - startedAt,
      };
    }
    await sleep(interval);
    interval = Math.min(interval * 1.5, 2000);
  }
  return null;
}

async function runOneSide(
  client: GmoClient,
  prisma: PrismaClient,
  side: "BUY" | "SELL",
  args: Args,
  tripIdx: number,
): Promise<AttemptRecord> {
  const ticker = await client.getTicker(SYMBOL);
  const refMid = (ticker.bid + ticker.ask) / 2;

  // offset_ticks > 0: closer to mid (more aggressive, may cross spread → taker)
  // offset_ticks < 0: further from mid (more passive maker)
  const insidePrice = side === "BUY" ? ticker.bid : ticker.ask;
  const offset = side === "BUY" ? args.offsetTicks : -args.offsetTicks;
  const limitPrice = insidePrice + offset * TICK_YEN;

  const noteBase = `trip=${tripIdx} wait=${args.waitSec}s offset=${args.offsetTicks}`;
  console.log(
    `\n  [${tripIdx}/${args.count}] ${side} ${SIZE} BTC | bid ${yen(ticker.bid)} ask ${yen(ticker.ask)} | LIMIT @ ${yen(limitPrice)}`,
  );

  const submittedAt = new Date();
  const limitResult = await client.placeOrder({
    symbol: SYMBOL,
    side,
    executionType: "LIMIT",
    size: SIZE,
    price: limitPrice,
  });
  await logOrder(prisma, {
    side,
    orderType: "LIMIT",
    requestedUnits: SIZE,
    requestedPrice: limitPrice,
    orderId: limitResult.orderId,
    status: "submitted",
    note: `${noteBase} stage=limit_submit`,
    submittedAt,
  });

  const fill = await waitForFill(
    client,
    limitResult.orderId,
    "LIMIT",
    args.waitSec * 1000,
  );

  let finalFill: FillResult;
  let limitFilled: boolean;
  let limitWaitMs: number;

  if (fill) {
    limitFilled = true;
    limitWaitMs = fill.pollMs;
    finalFill = fill;
    await logOrder(prisma, {
      side,
      orderType: "LIMIT",
      requestedUnits: SIZE,
      execUnits: fill.execUnits,
      execPrice: fill.execPrice,
      feeJpy: fill.feeJpy,
      orderId: fill.orderId,
      status: "filled",
      note: `${noteBase} stage=limit_fill wait_ms=${fill.pollMs}`,
      submittedAt: fill.filledAt,
      filledAt: fill.filledAt,
    });
    console.log(
      `      LIMIT filled in ${(fill.pollMs / 1000).toFixed(1)}s @ ${yen(fill.execPrice)} fee=${yen(fill.feeJpy)}`,
    );
  } else {
    limitFilled = false;
    limitWaitMs = args.waitSec * 1000;
    try {
      await client.cancelOrder(limitResult.orderId);
      await logOrder(prisma, {
        side,
        orderType: "LIMIT",
        requestedUnits: SIZE,
        orderId: limitResult.orderId,
        status: "cancelled",
        note: `${noteBase} stage=limit_timeout`,
        submittedAt: new Date(),
      });
    } catch (err) {
      console.warn(
        `      cancelOrder failed (may already be filled): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    console.log(`      LIMIT timeout after ${args.waitSec}s, falling back to MARKET`);
    const marketSubmittedAt = new Date();
    const marketResult = await client.placeOrder({
      symbol: SYMBOL,
      side,
      executionType: "MARKET",
      size: SIZE,
    });
    await logOrder(prisma, {
      side,
      orderType: "MARKET",
      requestedUnits: SIZE,
      orderId: marketResult.orderId,
      status: "submitted",
      note: `${noteBase} stage=market_submit`,
      submittedAt: marketSubmittedAt,
    });

    const marketFill = await waitForFill(
      client,
      marketResult.orderId,
      "MARKET",
      MARKET_WAIT_SEC * 1000,
    );
    if (!marketFill) {
      throw new Error(`${side} trip ${tripIdx}: MARKET no fill detected`);
    }
    finalFill = marketFill;
    await logOrder(prisma, {
      side,
      orderType: "MARKET",
      requestedUnits: SIZE,
      execUnits: marketFill.execUnits,
      execPrice: marketFill.execPrice,
      feeJpy: marketFill.feeJpy,
      orderId: marketFill.orderId,
      status: "filled",
      note: `${noteBase} stage=market_fill`,
      submittedAt: marketFill.filledAt,
      filledAt: marketFill.filledAt,
    });
    console.log(
      `      MARKET filled @ ${yen(marketFill.execPrice)} fee=${yen(marketFill.feeJpy)}`,
    );
  }

  const slippageBps =
    ((finalFill.execPrice - refMid) / refMid) * (side === "BUY" ? 10000 : -10000);

  return {
    tripIdx,
    side,
    refBid: ticker.bid,
    refAsk: ticker.ask,
    refMid,
    limitPrice,
    limitFilled,
    limitWaitMs,
    finalOrderType: finalFill.orderType,
    execPrice: finalFill.execPrice,
    execUnits: finalFill.execUnits,
    feeJpy: finalFill.feeJpy,
    slippageBps,
    ts: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const apiKey = process.env.GMO_API_KEY;
  const apiSecret = process.env.GMO_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error("GMO_API_KEY and GMO_API_SECRET must be set in .env");
  }

  const client = new GmoClient({ apiKey, apiSecret });
  const prisma = new PrismaClient();

  try {
    console.log("=== Round 12 — Maker fill rate experiment ===");
    console.log(
      `wait_sec=${args.waitSec}  offset_ticks=${args.offsetTicks}  count=${args.count} round-trips`,
    );

    const ticker = await client.getTicker(SYMBOL);
    const assets = await client.getAccountAssets();
    const jpy = assets.find((a) => a.symbol === "JPY")?.amount ?? 0;
    const btc = assets.find((a) => a.symbol === "BTC")?.amount ?? 0;
    console.log(
      `Pre balance: JPY ${yen(jpy)} / BTC ${btc.toFixed(8)}  | bid ${yen(ticker.bid)} ask ${yen(ticker.ask)}`,
    );

    const requiredJpy = SIZE * ((ticker.bid + ticker.ask) / 2) * 1.01;
    if (jpy < requiredJpy) {
      throw new Error(
        `insufficient JPY: have ${yen(jpy)}, need ~${yen(requiredJpy)} per trip`,
      );
    }

    const estimatedCost = args.count * 3;
    console.log(
      `Estimated total cost: ~¥${estimatedCost}  (≈${args.count} trips × ¥3)`,
    );
    if (!args.yes) {
      console.log("Dry-run mode (no --yes). Pass --yes to execute.");
      return;
    }

    const records: AttemptRecord[] = [];
    const start = Date.now();

    for (let i = 1; i <= args.count; i++) {
      console.log(`\n--- Round-trip ${i}/${args.count} ---`);
      const buy = await runOneSide(client, prisma, "BUY", args, i);
      records.push(buy);
      const sell = await runOneSide(client, prisma, "SELL", args, i);
      records.push(sell);
      if (i < args.count) {
        console.log(`  (sleeping ${SLEEP_BETWEEN_TRIPS_SEC}s before next trip)`);
        await sleep(SLEEP_BETWEEN_TRIPS_SEC * 1000);
      }
    }

    const elapsedSec = (Date.now() - start) / 1000;

    // Per-side summary
    const limitFills = records.filter((r) => r.limitFilled);
    const fillRate = (limitFills.length / records.length) * 100;
    const totalFee = records.reduce((s, r) => s + r.feeJpy, 0);
    const avgSlippage =
      records.reduce((s, r) => s + r.slippageBps, 0) / records.length;
    const limitFillEffectiveBps =
      limitFills.length > 0
        ? limitFills.reduce((s, r) => s + (r.feeJpy / (r.execPrice * r.execUnits)) * 10000, 0) /
          limitFills.length
        : 0;
    const taker = records.filter((r) => !r.limitFilled);
    const takerEffectiveBps =
      taker.length > 0
        ? taker.reduce((s, r) => s + (r.feeJpy / (r.execPrice * r.execUnits)) * 10000, 0) /
          taker.length
        : 0;
    const overallEffectiveBps =
      records.reduce((s, r) => s + (r.feeJpy / (r.execPrice * r.execUnits)) * 10000, 0) /
      records.length;

    console.log(`\n=== Summary ===`);
    console.log(`Elapsed:               ${elapsedSec.toFixed(1)}s`);
    console.log(`Total attempts:        ${records.length} (${args.count} round-trips)`);
    console.log(`LIMIT fills:           ${limitFills.length} (${fillRate.toFixed(1)}%)`);
    console.log(`MARKET fallbacks:      ${taker.length}`);
    console.log(
      `Avg LIMIT fill wait:   ${limitFills.length > 0 ? (limitFills.reduce((s, r) => s + r.limitWaitMs, 0) / limitFills.length / 1000).toFixed(1) : "—"}s`,
    );
    console.log(`Avg slippage:          ${avgSlippage.toFixed(2)} bps`);
    console.log(`LIMIT effective fee:   ${limitFillEffectiveBps.toFixed(2)} bps`);
    console.log(`MARKET effective fee:  ${takerEffectiveBps.toFixed(2)} bps`);
    console.log(`Overall effective fee: ${overallEffectiveBps.toFixed(2)} bps`);
    console.log(`Total fee:             ${yen(totalFee)}`);

    // CSV report
    const outDir = "reports/round-12";
    await fs.mkdir(outDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const csvPath = path.join(
      outDir,
      `maker-fill-w${args.waitSec}-o${args.offsetTicks}-${ts}.csv`,
    );
    const header =
      "ts,trip,side,refBid,refAsk,refMid,limitPrice,limitFilled,limitWaitMs,finalOrderType,execPrice,execUnits,feeJpy,slippageBps\n";
    const body = records
      .map(
        (r) =>
          `${r.ts},${r.tripIdx},${r.side},${r.refBid},${r.refAsk},${r.refMid},${r.limitPrice},${r.limitFilled},${r.limitWaitMs},${r.finalOrderType},${r.execPrice},${r.execUnits},${r.feeJpy},${r.slippageBps.toFixed(3)}`,
      )
      .join("\n");
    await fs.writeFile(csvPath, header + body + "\n", "utf-8");
    console.log(`\nCSV: ${csvPath}`);

    const postAssets = await client.getAccountAssets();
    const postJpy = postAssets.find((a) => a.symbol === "JPY")?.amount ?? 0;
    const postBtc = postAssets.find((a) => a.symbol === "BTC")?.amount ?? 0;
    console.log(
      `Post balance: JPY ${yen(postJpy)} / BTC ${postBtc.toFixed(8)} (JPY Δ ${yen(postJpy - jpy)}, BTC Δ ${(postBtc - btc).toFixed(8)})`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  if (err instanceof GmoApiError) {
    console.error(`\n❌ GMO API error:`);
    console.error(`  HTTP ${err.httpStatus}, GMO status ${err.gmoStatus}`);
    console.error(`  ${err.message}`);
    if (err.messages) {
      for (const m of err.messages) {
        console.error(`    ${m.message_code}: ${m.message_string}`);
      }
    }
  } else {
    console.error(`\n❌ ${err instanceof Error ? err.stack : String(err)}`);
  }
  process.exit(1);
});
