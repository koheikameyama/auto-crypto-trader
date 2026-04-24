import type { PrismaClient } from "@prisma/client";
import { GmoApiError, type GmoClient, type GmoSymbol } from "./gmo-client.js";
import { checkKillSwitch, DEFAULT_KILL_SWITCH } from "./kill-switch.js";

/**
 * Execute one day's rebalance on GMO Coin spot.
 *
 * Flow:
 *   1. Kill-switch check → if tripped, skip and record state unchanged.
 *   2. Fetch ticker (reference mid for slippage), account balance.
 *   3. Compute target JPY value and delta vs current position.
 *   4. If |delta / equity| < rebalanceThreshold → skip, record state.
 *   5. If order size < minLot → skip, record state.
 *   6. Maker-first: LIMIT at best bid/ask; poll up to makerLimitWaitSec.
 *   7. Fall back to MARKET if not filled in time.
 *   8. Compute slippage, upsert ActualPortfolioState, log to OrderLog.
 */

export type ActualAsset = "BTC" | "ETH";

const SPOT_SYMBOL: Record<ActualAsset, GmoSymbol> = {
  BTC: "BTC",
  ETH: "ETH",
};

/** GMO spot minimum order size (per asset). Source: GMO Coin website. */
const MIN_LOT: Record<ActualAsset, number> = {
  BTC: 0.0001,
  ETH: 0.01,
};

/** Decimal precision for placeOrder size. Must match exchange lot step. */
const SIZE_PRECISION: Record<ActualAsset, number> = {
  BTC: 4,
  ETH: 2,
};

export interface ExecutionAdapterInput {
  asset: ActualAsset;
  targetPosition: number;
  client: GmoClient;
  prisma: PrismaClient;
  today: Date;
  rebalanceThreshold: number;
  makerLimitWaitSec: number;
  dryRun?: boolean;
}

export interface ExecutionAdapterOutput {
  skipped: boolean;
  skipReason?: string;
  equityJpy: number;
  cashJpy: number;
  units: number;
  price: number;
  actualPosition: number;
  rebalancedToday: boolean;
  rebalanceDelta: number;
  feeJpy: number;
  slippageBps: number;
  cumulativeReturn: number;
  cumulativeFeeJpy: number;
}

interface AccountSnapshot {
  jpy: number;
  units: number;
}

interface FillResult {
  execPrice: number;
  execUnits: number;
  feeJpy: number;
  orderId: string;
  orderType: "LIMIT" | "MARKET";
  filledAt: Date;
}

const MS_PER_SEC = 1000;

export async function executeRebalance(
  input: ExecutionAdapterInput,
): Promise<ExecutionAdapterOutput> {
  const {
    asset,
    targetPosition,
    client,
    prisma,
    today,
    rebalanceThreshold,
    makerLimitWaitSec,
    dryRun,
  } = input;

  const killSwitch = await checkKillSwitch(prisma, asset, DEFAULT_KILL_SWITCH);
  if (!killSwitch.ok) {
    return await recordStateUnchanged(
      prisma,
      asset,
      today,
      targetPosition,
      `kill_switch: ${killSwitch.reason}`,
    );
  }

  const symbol = SPOT_SYMBOL[asset];
  const ticker = await client.getTicker(symbol);
  const refMid = (ticker.bid + ticker.ask) / 2;

  const account = await readAccountSnapshot(client, asset);
  const equityJpy = account.jpy + account.units * refMid;
  const currentValue = account.units * refMid;
  const currentPosition = equityJpy > 0 ? currentValue / equityJpy : 0;
  const targetValue = equityJpy * targetPosition;
  const deltaJpy = targetValue - currentValue;

  if (Math.abs(deltaJpy) / Math.max(equityJpy, 1) < rebalanceThreshold) {
    return await writeState({
      prisma,
      asset,
      today,
      refMid,
      targetPosition,
      account,
      equityJpy,
      currentPosition,
      rebalancedToday: false,
      rebalanceDelta: 0,
      feeJpy: 0,
      slippageBps: 0,
    });
  }

  const side: "BUY" | "SELL" = deltaJpy > 0 ? "BUY" : "SELL";
  const rawUnits = Math.abs(deltaJpy) / refMid;
  const sizeStr = rawUnits.toFixed(SIZE_PRECISION[asset]);
  const size = Number(sizeStr);

  if (size < MIN_LOT[asset]) {
    return await writeState({
      prisma,
      asset,
      today,
      refMid,
      targetPosition,
      account,
      equityJpy,
      currentPosition,
      rebalancedToday: false,
      rebalanceDelta: 0,
      feeJpy: 0,
      slippageBps: 0,
      skipReason: `size ${sizeStr} < min_lot ${MIN_LOT[asset]}`,
    });
  }

  if (dryRun) {
    return await writeState({
      prisma,
      asset,
      today,
      refMid,
      targetPosition,
      account,
      equityJpy,
      currentPosition,
      rebalancedToday: false,
      rebalanceDelta: 0,
      feeJpy: 0,
      slippageBps: 0,
      skipReason: `dry_run: would_${side.toLowerCase()}_${sizeStr}`,
    });
  }

  let fill: FillResult | null = null;
  let makerOrderId: string | null = null;

  try {
    const makerPrice = side === "BUY" ? ticker.bid : ticker.ask;
    const submittedAt = new Date();
    const orderResult = await client.placeOrder({
      symbol,
      side,
      executionType: "LIMIT",
      size,
      price: makerPrice,
    });
    makerOrderId = orderResult.orderId;
    await logOrder(prisma, {
      asset,
      today,
      side,
      orderType: "LIMIT",
      requestedUnits: size,
      requestedPrice: makerPrice,
      orderId: makerOrderId,
      status: "submitted",
      submittedAt,
    });

    fill = await waitForFill({
      client,
      asset,
      symbol,
      orderId: makerOrderId,
      side,
      submittedAt,
      timeoutMs: makerLimitWaitSec * MS_PER_SEC,
    });
  } catch (err) {
    const message = gmoErrorMessage(err);
    await logOrder(prisma, {
      asset,
      today,
      side,
      orderType: "LIMIT",
      requestedUnits: size,
      status: "failed",
      submittedAt: new Date(),
      errorMessage: message,
    });
    throw err;
  }

  if (!fill && makerOrderId) {
    try {
      await client.cancelOrder(makerOrderId);
      await logOrder(prisma, {
        asset,
        today,
        side,
        orderType: "LIMIT",
        requestedUnits: size,
        orderId: makerOrderId,
        status: "cancelled",
        submittedAt: new Date(),
      });
    } catch (err) {
      console.warn(
        `cancelOrder failed (may be already filled): ${gmoErrorMessage(err)}`,
      );
    }

    const submittedAt = new Date();
    try {
      const marketResult = await client.placeOrder({
        symbol,
        side,
        executionType: "MARKET",
        size,
      });
      await logOrder(prisma, {
        asset,
        today,
        side,
        orderType: "MARKET",
        requestedUnits: size,
        orderId: marketResult.orderId,
        status: "submitted",
        submittedAt,
      });
      fill = await waitForFill({
        client,
        asset,
        symbol,
        orderId: marketResult.orderId,
        side,
        submittedAt,
        timeoutMs: 10 * MS_PER_SEC,
      });
    } catch (err) {
      const message = gmoErrorMessage(err);
      await logOrder(prisma, {
        asset,
        today,
        side,
        orderType: "MARKET",
        requestedUnits: size,
        status: "failed",
        submittedAt: new Date(),
        errorMessage: message,
      });
      throw err;
    }
  }

  if (!fill) {
    throw new Error(`order placed but no fill detected for ${asset}`);
  }

  await logOrder(prisma, {
    asset,
    today,
    side,
    orderType: fill.orderType,
    requestedUnits: size,
    execUnits: fill.execUnits,
    execPrice: fill.execPrice,
    feeJpy: fill.feeJpy,
    orderId: fill.orderId,
    status: "filled",
    submittedAt: fill.filledAt,
    filledAt: fill.filledAt,
  });

  const signedDelta = side === "BUY" ? fill.execUnits : -fill.execUnits;
  const postCashJpy =
    side === "BUY"
      ? account.jpy - fill.execUnits * fill.execPrice - fill.feeJpy
      : account.jpy + fill.execUnits * fill.execPrice - fill.feeJpy;
  const postUnits = account.units + signedDelta;
  const postEquity = postCashJpy + postUnits * refMid;

  const slippageBps =
    ((fill.execPrice - refMid) / refMid) * (side === "BUY" ? 10000 : -10000);

  return await writeState({
    prisma,
    asset,
    today,
    refMid,
    targetPosition,
    account: { jpy: postCashJpy, units: postUnits },
    equityJpy: postEquity,
    currentPosition: postEquity > 0 ? (postUnits * refMid) / postEquity : 0,
    rebalancedToday: true,
    rebalanceDelta: signedDelta,
    feeJpy: fill.feeJpy,
    slippageBps,
  });
}

async function readAccountSnapshot(
  client: GmoClient,
  asset: ActualAsset,
): Promise<AccountSnapshot> {
  const assets = await client.getAccountAssets();
  const jpy = assets.find((a) => a.symbol === "JPY")?.amount ?? 0;
  const units = assets.find((a) => a.symbol === asset)?.amount ?? 0;
  return { jpy, units };
}

interface WaitForFillInput {
  client: GmoClient;
  asset: ActualAsset;
  symbol: GmoSymbol;
  orderId: string;
  side: "BUY" | "SELL";
  submittedAt: Date;
  timeoutMs: number;
}

async function waitForFill(input: WaitForFillInput): Promise<FillResult | null> {
  const { client, symbol, orderId, timeoutMs } = input;
  const deadline = Date.now() + timeoutMs;
  let pollIntervalMs = 500;
  while (Date.now() < deadline) {
    const executions = await client.getLatestExecutions(symbol);
    const matches = executions.filter((e) => e.orderId === orderId);
    if (matches.length > 0) {
      const totalSize = matches.reduce((s, e) => s + e.size, 0);
      const weightedPrice =
        matches.reduce((s, e) => s + e.price * e.size, 0) / totalSize;
      const feeJpy = matches.reduce((s, e) => s + e.fee, 0);
      return {
        execPrice: weightedPrice,
        execUnits: totalSize,
        feeJpy,
        orderId,
        orderType: "LIMIT",
        filledAt: new Date(matches[matches.length - 1]?.timestamp ?? Date.now()),
      };
    }
    await sleep(pollIntervalMs);
    pollIntervalMs = Math.min(pollIntervalMs * 1.5, 2000);
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface LogOrderInput {
  asset: string;
  today: Date;
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
}

async function logOrder(
  prisma: PrismaClient,
  input: LogOrderInput,
): Promise<void> {
  await prisma.orderLog.create({
    data: {
      asset: input.asset,
      date: input.today,
      side: input.side,
      orderType: input.orderType,
      requestedUnits: input.requestedUnits,
      execUnits: input.execUnits ?? null,
      requestedPrice: input.requestedPrice ?? null,
      execPrice: input.execPrice ?? null,
      feeJpy: input.feeJpy ?? null,
      orderId: input.orderId ?? null,
      status: input.status,
      errorMessage: input.errorMessage ?? null,
      submittedAt: input.submittedAt,
      filledAt: input.filledAt ?? null,
    },
  });
}

function gmoErrorMessage(err: unknown): string {
  if (err instanceof GmoApiError) {
    const msgs =
      err.messages?.map((m) => `${m.message_code}:${m.message_string}`).join("; ") ??
      "";
    return `HTTP ${err.httpStatus} GMO ${err.gmoStatus} ${err.message} ${msgs}`.trim();
  }
  return err instanceof Error ? err.message : String(err);
}

interface WriteStateInput {
  prisma: PrismaClient;
  asset: string;
  today: Date;
  refMid: number;
  targetPosition: number;
  account: AccountSnapshot;
  equityJpy: number;
  currentPosition: number;
  rebalancedToday: boolean;
  rebalanceDelta: number;
  feeJpy: number;
  slippageBps: number;
  skipReason?: string;
}

async function writeState(
  input: WriteStateInput,
): Promise<ExecutionAdapterOutput> {
  const {
    prisma,
    asset,
    today,
    refMid,
    targetPosition,
    account,
    equityJpy,
    currentPosition,
    rebalancedToday,
    rebalanceDelta,
    feeJpy,
    slippageBps,
    skipReason,
  } = input;

  const prev = await prisma.actualPortfolioState.findFirst({
    where: { asset, date: { lt: today } },
    orderBy: { date: "desc" },
  });
  const first = await prisma.actualPortfolioState.findFirst({
    where: { asset },
    orderBy: { date: "asc" },
  });
  const initialCapitalJpy = first
    ? first.equityJpy + first.feeJpy
    : equityJpy;
  const cumulativeReturn =
    initialCapitalJpy > 0 ? (equityJpy - initialCapitalJpy) / initialCapitalJpy : 0;
  const cumulativeFeeJpy = (prev?.cumulativeFeeJpy ?? 0) + feeJpy;

  await prisma.actualPortfolioState.upsert({
    where: { asset_date: { asset, date: today } },
    create: {
      asset,
      date: today,
      price: refMid,
      targetPosition,
      actualPosition: currentPosition,
      cashJpy: account.jpy,
      units: account.units,
      equityJpy,
      rebalancedToday,
      rebalanceDelta,
      feeJpy,
      slippageBps,
      cumulativeReturn,
      cumulativeFeeJpy,
    },
    update: {
      price: refMid,
      targetPosition,
      actualPosition: currentPosition,
      cashJpy: account.jpy,
      units: account.units,
      equityJpy,
      rebalancedToday,
      rebalanceDelta,
      feeJpy,
      slippageBps,
      cumulativeReturn,
      cumulativeFeeJpy,
    },
  });

  return {
    skipped: !rebalancedToday,
    skipReason,
    equityJpy,
    cashJpy: account.jpy,
    units: account.units,
    price: refMid,
    actualPosition: currentPosition,
    rebalancedToday,
    rebalanceDelta,
    feeJpy,
    slippageBps,
    cumulativeReturn,
    cumulativeFeeJpy,
  };
}

async function recordStateUnchanged(
  prisma: PrismaClient,
  asset: string,
  today: Date,
  targetPosition: number,
  skipReason: string,
): Promise<ExecutionAdapterOutput> {
  const prev = await prisma.actualPortfolioState.findFirst({
    where: { asset, date: { lt: today } },
    orderBy: { date: "desc" },
  });
  if (!prev) {
    return {
      skipped: true,
      skipReason,
      equityJpy: 0,
      cashJpy: 0,
      units: 0,
      price: 0,
      actualPosition: 0,
      rebalancedToday: false,
      rebalanceDelta: 0,
      feeJpy: 0,
      slippageBps: 0,
      cumulativeReturn: 0,
      cumulativeFeeJpy: 0,
    };
  }
  return {
    skipped: true,
    skipReason,
    equityJpy: prev.equityJpy,
    cashJpy: prev.cashJpy,
    units: prev.units,
    price: prev.price,
    actualPosition: prev.actualPosition,
    rebalancedToday: false,
    rebalanceDelta: 0,
    feeJpy: 0,
    slippageBps: 0,
    cumulativeReturn: prev.cumulativeReturn,
    cumulativeFeeJpy: prev.cumulativeFeeJpy,
  };
}
