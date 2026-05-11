/**
 * Manual end-to-end execution test: BTC minimum-lot BUY → SELL round-trip.
 *
 * Purpose: verify the GMO order path (placeOrder maker-first / waitForFill /
 * MARKET fallback / OrderLog writes) without waiting for a natural rebalance.
 *
 * Writes to OrderLog (errorMessage prefixed `manual_test`) but NOT to
 * ActualPortfolioState — keeps Phase 2.1 measurement ledger clean.
 *
 * Usage:
 *   npx tsx scripts/test-execution-roundtrip.ts --yes
 *
 * Without --yes the script prints the plan and exits.
 */

import { PrismaClient } from "@prisma/client";
import { GmoApiError, GmoClient, type GmoSymbol } from "../src/live/gmo-client.js";

const SYMBOL: GmoSymbol = "BTC";
const SIZE = 0.0001; // GMO BTC minimum lot
const MAKER_WAIT_SEC = 10;
const MARKET_WAIT_SEC = 10;
const TEST_TAG = "manual_test_roundtrip";

interface FillResult {
  execPrice: number;
  execUnits: number;
  feeJpy: number;
  orderId: string;
  orderType: "LIMIT" | "MARKET";
  filledAt: Date;
}

const yen = (n: number): string =>
  `¥${n.toLocaleString("ja-JP", { maximumFractionDigits: 2 })}`;

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
    errorMessage?: string;
    submittedAt: Date;
    filledAt?: Date;
  },
): Promise<void> {
  const tagged = input.errorMessage
    ? `${TEST_TAG}: ${input.errorMessage}`
    : TEST_TAG;
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForFill(
  client: GmoClient,
  orderId: string,
  orderType: "LIMIT" | "MARKET",
  timeoutMs: number,
): Promise<FillResult | null> {
  const deadline = Date.now() + timeoutMs;
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
      };
    }
    await sleep(interval);
    interval = Math.min(interval * 1.5, 2000);
  }
  return null;
}

async function placeRoundTripSide(
  client: GmoClient,
  prisma: PrismaClient,
  side: "BUY" | "SELL",
): Promise<{ fill: FillResult; refMid: number; slippageBps: number }> {
  const ticker = await client.getTicker(SYMBOL);
  const refMid = (ticker.bid + ticker.ask) / 2;
  const makerPrice = side === "BUY" ? ticker.bid : ticker.ask;

  console.log(`\n--- ${side} ${SIZE} BTC ---`);
  console.log(
    `Ticker bid ${yen(ticker.bid)} / ask ${yen(ticker.ask)} / mid ${yen(refMid)}`,
  );
  console.log(`Maker LIMIT @ ${yen(makerPrice)}`);

  let fill: FillResult | null = null;
  let makerOrderId: string | null = null;

  const submittedAt = new Date();
  const limitResult = await client.placeOrder({
    symbol: SYMBOL,
    side,
    executionType: "LIMIT",
    size: SIZE,
    price: makerPrice,
  });
  makerOrderId = limitResult.orderId;
  await logOrder(prisma, {
    side,
    orderType: "LIMIT",
    requestedUnits: SIZE,
    requestedPrice: makerPrice,
    orderId: makerOrderId,
    status: "submitted",
    submittedAt,
  });
  console.log(`LIMIT submitted, orderId=${makerOrderId}, polling fill...`);

  fill = await waitForFill(
    client,
    makerOrderId,
    "LIMIT",
    MAKER_WAIT_SEC * 1000,
  );

  if (!fill && makerOrderId) {
    console.log(`LIMIT not filled in ${MAKER_WAIT_SEC}s, cancelling and falling back to MARKET`);
    try {
      await client.cancelOrder(makerOrderId);
      await logOrder(prisma, {
        side,
        orderType: "LIMIT",
        requestedUnits: SIZE,
        orderId: makerOrderId,
        status: "cancelled",
        submittedAt: new Date(),
      });
    } catch (err) {
      console.warn(
        `cancelOrder failed (may already be filled): ${err instanceof Error ? err.message : String(err)}`,
      );
    }

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
      submittedAt: marketSubmittedAt,
    });
    console.log(`MARKET submitted, orderId=${marketResult.orderId}`);

    fill = await waitForFill(
      client,
      marketResult.orderId,
      "MARKET",
      MARKET_WAIT_SEC * 1000,
    );
  }

  if (!fill) {
    throw new Error(`${side}: order placed but no fill detected`);
  }

  await logOrder(prisma, {
    side,
    orderType: fill.orderType,
    requestedUnits: SIZE,
    execUnits: fill.execUnits,
    execPrice: fill.execPrice,
    feeJpy: fill.feeJpy,
    orderId: fill.orderId,
    status: "filled",
    submittedAt: fill.filledAt,
    filledAt: fill.filledAt,
  });

  const slippageBps =
    ((fill.execPrice - refMid) / refMid) * (side === "BUY" ? 10000 : -10000);

  console.log(
    `Filled: ${fill.orderType} ${fill.execUnits} BTC @ ${yen(fill.execPrice)} fee=${yen(fill.feeJpy)} slip=${slippageBps.toFixed(1)}bps`,
  );

  return { fill, refMid, slippageBps };
}

async function main(): Promise<void> {
  const yes = process.argv.includes("--yes");
  const apiKey = process.env.GMO_API_KEY;
  const apiSecret = process.env.GMO_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error("GMO_API_KEY and GMO_API_SECRET must be set in .env");
  }

  const client = new GmoClient({ apiKey, apiSecret });
  const prisma = new PrismaClient();

  try {
    console.log("=== Pre-flight check ===");
    const ticker = await client.getTicker(SYMBOL);
    const refMid = (ticker.bid + ticker.ask) / 2;
    console.log(`BTC ticker: bid ${yen(ticker.bid)} / ask ${yen(ticker.ask)}`);

    const assets = await client.getAccountAssets();
    const jpy = assets.find((a) => a.symbol === "JPY")?.amount ?? 0;
    const btc = assets.find((a) => a.symbol === "BTC")?.amount ?? 0;
    console.log(`Balance: JPY ${yen(jpy)} / BTC ${btc.toFixed(8)}`);

    const requiredJpy = SIZE * refMid * 1.01; // 1% buffer
    if (jpy < requiredJpy) {
      throw new Error(
        `insufficient JPY: have ${yen(jpy)}, need ~${yen(requiredJpy)}`,
      );
    }
    console.log(`Required JPY for BUY (with 1% buffer): ${yen(requiredJpy)} ✓`);

    const plan = `\n=== Plan ===\n` +
      `1. BUY  ${SIZE} BTC (~${yen(SIZE * refMid)})\n` +
      `2. SELL ${SIZE} BTC (~${yen(SIZE * refMid)})\n` +
      `Net position change: 0 BTC (round-trip)\n` +
      `Estimated cost: ~¥3 (2x fees + slippage)\n`;
    console.log(plan);

    if (!yes) {
      console.log("Dry-run mode (no --yes). Pass --yes to execute.");
      return;
    }

    console.log("=== Executing round-trip ===");
    const start = Date.now();

    const buy = await placeRoundTripSide(client, prisma, "BUY");
    const sell = await placeRoundTripSide(client, prisma, "SELL");

    const elapsedSec = (Date.now() - start) / 1000;
    const totalFee = buy.fill.feeJpy + sell.fill.feeJpy;
    const grossPnl =
      sell.fill.execPrice * sell.fill.execUnits -
      buy.fill.execPrice * buy.fill.execUnits;
    const netPnl = grossPnl - totalFee;

    console.log(`\n=== Round-trip Summary ===`);
    console.log(`Elapsed:     ${elapsedSec.toFixed(1)}s`);
    console.log(
      `BUY:  ${buy.fill.orderType} @ ${yen(buy.fill.execPrice)} (slip ${buy.slippageBps.toFixed(1)}bps, fee ${yen(buy.fill.feeJpy)})`,
    );
    console.log(
      `SELL: ${sell.fill.orderType} @ ${yen(sell.fill.execPrice)} (slip ${sell.slippageBps.toFixed(1)}bps, fee ${yen(sell.fill.feeJpy)})`,
    );
    console.log(`Total fee:   ${yen(totalFee)}`);
    console.log(`Gross P&L:   ${yen(grossPnl)} (price diff)`);
    console.log(`Net P&L:     ${yen(netPnl)}`);

    const postAssets = await client.getAccountAssets();
    const postJpy = postAssets.find((a) => a.symbol === "JPY")?.amount ?? 0;
    const postBtc = postAssets.find((a) => a.symbol === "BTC")?.amount ?? 0;
    console.log(`\nPost balance: JPY ${yen(postJpy)} / BTC ${postBtc.toFixed(8)}`);
    console.log(`JPY change:   ${yen(postJpy - jpy)}`);
    console.log(`BTC change:   ${(postBtc - btc).toFixed(8)} (expected ~0)`);
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
