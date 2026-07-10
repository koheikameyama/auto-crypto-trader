import type { PrismaClient } from "@prisma/client";
import { GmoApiError, type GmoClient, type GmoSymbol } from "./gmo-client.js";
import {
  checkOrderFailureKill,
  checkDrawdownKill,
  DEFAULT_KILL_SWITCH,
} from "./kill-switch.js";

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
  /**
   * This asset's share of total account equity (multi-asset allocation).
   * Defaults to 1.0 (single-asset: the asset owns the whole account).
   */
  allocationWeight?: number;
  /**
   * Full set of assets sharing the GMO account. Used to value the whole
   * account (JPY + every asset's holdings) so this asset can size its trade
   * against its allocated slice rather than the entire JPY pool (forbidden #6).
   * Defaults to [asset] (single-asset).
   */
  allocationAssets?: ActualAsset[];
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
    allocationWeight = 1,
    allocationAssets = [asset],
  } = input;

  const depositJpy = await fetchTodayDeposit(prisma, asset, today);

  // Phase-1 kill-switch: consecutive order failures. DB-only, so it runs before
  // any exchange call and a dead API is not hammered further.
  const failureKill = await checkOrderFailureKill(
    prisma,
    asset,
    DEFAULT_KILL_SWITCH,
  );
  if (!failureKill.ok) {
    return await recordStateUnchanged(
      prisma,
      asset,
      today,
      targetPosition,
      `kill_switch: ${failureKill.reason}`,
    );
  }

  const symbol = SPOT_SYMBOL[asset];
  const ticker = await client.getTicker(symbol);
  const refMid = (ticker.bid + ticker.ask) / 2;

  const account = await readAccountSnapshot(client, asset);
  // Value the WHOLE account (shared JPY + every allocation asset's holdings),
  // then take this asset's slice. With allocationWeight=1 / allocationAssets=[asset]
  // this reduces exactly to the legacy single-asset equity (jpy + units*mid).
  const peerHoldingsValueJpy = await valuePeerHoldings(
    client,
    asset,
    allocationAssets,
  );
  const totalEquityJpy = account.jpy + account.units * refMid + peerHoldingsValueJpy;

  // Phase-2 kill-switch: portfolio-level drawdown on the live account snapshot
  // (single source of truth). Must use the whole-account equity, not per-asset
  // rows/return, or a multi-asset reallocation false-trips it (see kill-switch.ts).
  const drawdownKill = await checkDrawdownKill(
    prisma,
    totalEquityJpy,
    DEFAULT_KILL_SWITCH,
  );
  if (!drawdownKill.ok) {
    return await recordStateUnchanged(
      prisma,
      asset,
      today,
      targetPosition,
      `kill_switch: ${drawdownKill.reason}`,
    );
  }

  const subEquityJpy = totalEquityJpy * allocationWeight;
  const currentValue = account.units * refMid;
  const currentPosition = subEquityJpy > 0 ? currentValue / subEquityJpy : 0;
  const targetValue = subEquityJpy * targetPosition;
  const deltaJpy = targetValue - currentValue;

  // The per-asset row records the ALLOCATED slice, not the raw shared JPY, so
  // summing BTC + ETH rows never double-counts the single JPY balance.
  const allocatedAccount = {
    jpy: subEquityJpy - currentValue,
    units: account.units,
  };

  if (Math.abs(deltaJpy) / Math.max(subEquityJpy, 1) < rebalanceThreshold) {
    return await writeState({
      prisma,
      asset,
      today,
      refMid,
      targetPosition,
      account: allocatedAccount,
      equityJpy: subEquityJpy,
      totalEquityJpy,
      currentPosition,
      rebalancedToday: false,
      rebalanceDelta: 0,
      feeJpy: 0,
      slippageBps: 0,
      depositJpy,
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
      account: allocatedAccount,
      equityJpy: subEquityJpy,
      totalEquityJpy,
      currentPosition,
      rebalancedToday: false,
      rebalanceDelta: 0,
      feeJpy: 0,
      slippageBps: 0,
      depositJpy,
      skipReason: `size ${sizeStr} < min_lot ${MIN_LOT[asset]}`,
    });
  }

  if (dryRun) {
    // Dry-run is side-effect-free: it must NOT upsert ActualPortfolioState,
    // or running it on a live asset would overwrite that day's real ledger row.
    // Read prev (read-only) only to report cumulative return.
    const prev = await prisma.actualPortfolioState.findFirst({
      where: { asset, date: { lt: today } },
      orderBy: { date: "desc" },
    });
    return {
      skipped: true,
      skipReason: `dry_run: would_${side.toLowerCase()}_${sizeStr}`,
      equityJpy: subEquityJpy,
      cashJpy: allocatedAccount.jpy,
      units: allocatedAccount.units,
      price: refMid,
      actualPosition: currentPosition,
      rebalancedToday: false,
      rebalanceDelta: 0,
      feeJpy: 0,
      slippageBps: 0,
      cumulativeReturn: await computePortfolioCumret(
        prisma,
        asset,
        today,
        totalEquityJpy,
      ),
      cumulativeFeeJpy: prev?.cumulativeFeeJpy ?? 0,
    };
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
      orderType: "LIMIT",
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
        orderType: "MARKET",
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
  // Re-slice post-trade: total equity is conserved through the trade (peer
  // holdings unchanged), so recompute this asset's allocated equity from the
  // new shared JPY + own holdings + unchanged peer value.
  const postTotalEquity = postCashJpy + postUnits * refMid + peerHoldingsValueJpy;
  const postSubEquity = postTotalEquity * allocationWeight;
  const postOwnValue = postUnits * refMid;

  const slippageBps =
    ((fill.execPrice - refMid) / refMid) * (side === "BUY" ? 10000 : -10000);

  return await writeState({
    prisma,
    asset,
    today,
    refMid,
    targetPosition,
    account: { jpy: postSubEquity - postOwnValue, units: postUnits },
    equityJpy: postSubEquity,
    totalEquityJpy: postTotalEquity,
    currentPosition: postSubEquity > 0 ? postOwnValue / postSubEquity : 0,
    rebalancedToday: true,
    rebalanceDelta: signedDelta,
    feeJpy: fill.feeJpy,
    slippageBps,
    depositJpy,
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

/**
 * JPY value of holdings for every allocation asset OTHER than `ownAsset`,
 * priced at each peer's ref mid. Used to value the full shared GMO account so
 * `ownAsset` can size against its allocated slice. Returns 0 for the
 * single-asset case (allocationAssets = [ownAsset]).
 */
async function valuePeerHoldings(
  client: GmoClient,
  ownAsset: ActualAsset,
  allocationAssets: ActualAsset[],
): Promise<number> {
  let total = 0;
  for (const peer of allocationAssets) {
    if (peer === ownAsset) continue;
    const ticker = await client.getTicker(SPOT_SYMBOL[peer]);
    const mid = (ticker.bid + ticker.ask) / 2;
    const snap = await readAccountSnapshot(client, peer);
    total += snap.units * mid;
  }
  return total;
}

interface WaitForFillInput {
  client: GmoClient;
  asset: ActualAsset;
  symbol: GmoSymbol;
  orderId: string;
  orderType: "LIMIT" | "MARKET";
  side: "BUY" | "SELL";
  submittedAt: Date;
  timeoutMs: number;
}

async function waitForFill(input: WaitForFillInput): Promise<FillResult | null> {
  const { client, symbol, orderId, orderType, timeoutMs } = input;
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
        orderType,
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
  /** Whole-account equity (all allocation assets) — used for portfolio cumret. */
  totalEquityJpy: number;
  currentPosition: number;
  rebalancedToday: boolean;
  rebalanceDelta: number;
  feeJpy: number;
  slippageBps: number;
  depositJpy: number;
  skipReason?: string;
}

/**
 * Reads today's recorded deposit (if any) from DepositEvent. Returns 0 when
 * there's no event. Persisting deposits in a dedicated table — rather than as
 * a CLI flag on the daily run — means the user can record a top-up at any
 * time (before, on, or after the deposit date) and the right row will pick
 * it up via the unique (asset, date) constraint.
 */
async function fetchTodayDeposit(
  prisma: PrismaClient,
  asset: string,
  today: Date,
): Promise<number> {
  const event = await prisma.depositEvent.findFirst({
    where: { asset, date: today },
  });
  return event?.amountJpy ?? 0;
}

/**
 * Portfolio-level time-weighted cumulative return, neutralizing BOTH external
 * deposits and internal inter-asset reallocation.
 *
 * The per-asset equity slice is `weight × totalAccountEquity`, so when the
 * allocation weight changes (e.g. BTC-only → BTC+ETH) the slice jumps with no
 * real P&L. Measuring the daily return on the WHOLE account rather than the
 * slice makes the reallocation invisible — a transfer between two assets'
 * slices nets to zero at the account level. Every asset's row therefore
 * carries the same portfolio cumret. Without this, the 2026-07 ETH rollout
 * read a spurious -50% one-day loss on BTC (its slice halved as capital moved
 * to ETH) and corrupted the series.
 *
 *   dailyReturn = (totalEquity - portfolioDeposit - prevTotalEquity) / prevTotalEquity
 *   cumret      = (1 + prevCumret) * (1 + dailyReturn) - 1
 *
 * prevTotalEquity is reconstructed from the previous row's slice and the number
 * of assets sharing the account that day (equal-weight ⇒ weight = 1/N). With a
 * single asset this reduces exactly to the legacy full-capital TWR.
 */
async function computePortfolioCumret(
  prisma: PrismaClient,
  asset: string,
  today: Date,
  totalEquityJpy: number,
): Promise<number> {
  const prev = await prisma.actualPortfolioState.findFirst({
    where: { asset, date: { lt: today } },
    orderBy: { date: "desc" },
  });
  if (!prev || prev.equityJpy <= 0) return 0;

  const prevAssetCount = await prisma.actualPortfolioState.count({
    where: { date: prev.date },
  });
  const prevWeight = prevAssetCount > 0 ? 1 / prevAssetCount : 1;
  const prevTotalEquity = prev.equityJpy / prevWeight;

  // Deposits land in the shared JPY pool, so a top-up on any asset is a
  // portfolio-level injection that must be netted out of the return.
  const depAgg = await prisma.depositEvent.aggregate({
    _sum: { amountJpy: true },
    where: { date: today },
  });
  const portfolioDeposit = depAgg._sum.amountJpy ?? 0;

  const dailyReturn =
    (totalEquityJpy - portfolioDeposit - prevTotalEquity) / prevTotalEquity;
  return (1 + prev.cumulativeReturn) * (1 + dailyReturn) - 1;
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
    totalEquityJpy,
    currentPosition,
    rebalancedToday,
    rebalanceDelta,
    feeJpy,
    slippageBps,
    depositJpy,
    skipReason,
  } = input;

  const prev = await prisma.actualPortfolioState.findFirst({
    where: { asset, date: { lt: today } },
    orderBy: { date: "desc" },
  });
  const cumulativeReturn = await computePortfolioCumret(
    prisma,
    asset,
    today,
    totalEquityJpy,
  );
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
      depositJpy,
      skipReason: skipReason ?? null,
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
      depositJpy,
      skipReason: skipReason ?? null,
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

/**
 * Persist a carry-over row when we can't reach the exchange (kill switch trip,
 * GMO maintenance, etc.). Mirrors the previous day's position, sets
 * rebalancedToday=false, and records skipReason. Without this, ActualPortfolioState
 * is missing rows on those days and Compare dashboards show gaps.
 */
export async function recordStateUnchanged(
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

  await prisma.actualPortfolioState.upsert({
    where: { asset_date: { asset, date: today } },
    create: {
      asset,
      date: today,
      price: prev.price,
      targetPosition,
      actualPosition: prev.actualPosition,
      cashJpy: prev.cashJpy,
      units: prev.units,
      equityJpy: prev.equityJpy,
      rebalancedToday: false,
      rebalanceDelta: 0,
      feeJpy: 0,
      slippageBps: 0,
      cumulativeReturn: prev.cumulativeReturn,
      cumulativeFeeJpy: prev.cumulativeFeeJpy,
      depositJpy: 0,
      skipReason,
    },
    update: {
      targetPosition,
      skipReason,
    },
  });

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
