import type { PrismaClient } from "@prisma/client";

export interface KillSwitchDecision {
  ok: boolean;
  reason?: string;
}

export interface KillSwitchConfig {
  maxConsecutiveFailures: number;
  maxDrawdown: number;
}

export const DEFAULT_KILL_SWITCH: KillSwitchConfig = {
  maxConsecutiveFailures: 3,
  maxDrawdown: 0.30,
};

/**
 * Phase-1 pre-execution guard (DB-only, runs BEFORE any exchange call so a dead
 * API is not hammered further). Trips when the last N consecutive OrderLog
 * entries for this asset are all `status=failed`.
 */
export async function checkOrderFailureKill(
  prisma: PrismaClient,
  asset: string,
  config: KillSwitchConfig = DEFAULT_KILL_SWITCH,
): Promise<KillSwitchDecision> {
  const recentOrders = await prisma.orderLog.findMany({
    where: { asset },
    orderBy: { submittedAt: "desc" },
    take: config.maxConsecutiveFailures,
  });
  if (
    recentOrders.length >= config.maxConsecutiveFailures &&
    recentOrders.every((o) => o.status === "failed")
  ) {
    return {
      ok: false,
      reason: `consecutive ${config.maxConsecutiveFailures} order failures`,
    };
  }
  return { ok: true };
}

/**
 * Phase-2 drawdown guard. Halts when total account equity has fallen
 * ≥ maxDrawdown below total deposited capital.
 *
 * Computed on the WHOLE account (all allocation assets share one JPY pool),
 * NOT per-asset. A multi-asset reallocation shifts capital between assets'
 * equity slices without any real loss, so a per-asset equity/return would
 * false-trip. Concretely: the 2026-07 ETH rollout halved BTC's slice
 * (¥93,244 → ¥46,849) as capital moved to ETH; the old per-asset cumulative
 * return read -52.6% and froze BTC for days with zero real portfolio loss.
 *
 * `portfolioEquityJpy` must come from the live account snapshot (single source
 * of truth), not from summing per-asset ActualPortfolioState rows — those
 * double-count on skip days (one asset carries a stale full-account equity
 * while another books its slice).
 */
export async function checkDrawdownKill(
  prisma: PrismaClient,
  portfolioEquityJpy: number,
  config: KillSwitchConfig = DEFAULT_KILL_SWITCH,
): Promise<KillSwitchDecision> {
  // A non-positive equity means the snapshot could not be valued (transient
  // read glitch) — don't trip on it; let the order flow surface the failure.
  if (portfolioEquityJpy <= 0) return { ok: true };

  const agg = await prisma.depositEvent.aggregate({
    _sum: { amountJpy: true },
  });
  const totalDeposits = agg._sum.amountJpy ?? 0;
  if (totalDeposits <= 0) return { ok: true };

  const drawdown = portfolioEquityJpy / totalDeposits - 1;
  if (drawdown <= -config.maxDrawdown) {
    return {
      ok: false,
      reason: `portfolio drawdown ${(drawdown * 100).toFixed(1)}% ≤ -${(config.maxDrawdown * 100).toFixed(0)}%`,
    };
  }
  return { ok: true };
}

export interface AlertCheckConfig {
  slippageBpsWarn: number;
  virtualVsActualDiffWarn: number;
  drawdownWarn: number;
}

export const DEFAULT_ALERT_CONFIG: AlertCheckConfig = {
  slippageBpsWarn: 50,
  virtualVsActualDiffWarn: 0.02,
  drawdownWarn: 0.10,
};

export interface Alert {
  severity: "warn" | "error";
  code: string;
  message: string;
}

/**
 * Post-execution alert check. Caller should forward results to Slack.
 * These do NOT stop execution — they only signal attention.
 */
export async function checkAlerts(
  prisma: PrismaClient,
  asset: string,
  todayActual: {
    slippageBps: number;
    cumulativeReturn: number;
  },
  todayVirtual: {
    cumulativeReturn: number;
  } | null,
  config: AlertCheckConfig = DEFAULT_ALERT_CONFIG,
): Promise<Alert[]> {
  const alerts: Alert[] = [];

  if (Math.abs(todayActual.slippageBps) > config.slippageBpsWarn) {
    alerts.push({
      severity: "warn",
      code: "slippage_high",
      message: `${asset}: slippage ${todayActual.slippageBps.toFixed(1)}bps > ${config.slippageBpsWarn}bps`,
    });
  }

  if (todayVirtual) {
    const diff = todayActual.cumulativeReturn - todayVirtual.cumulativeReturn;
    if (Math.abs(diff) > config.virtualVsActualDiffWarn) {
      alerts.push({
        severity: "warn",
        code: "virtual_actual_divergence",
        message: `${asset}: actual vs virtual return diff ${(diff * 100).toFixed(2)}pp > ${(config.virtualVsActualDiffWarn * 100).toFixed(1)}pp`,
      });
    }
  }

  if (todayActual.cumulativeReturn <= -config.drawdownWarn) {
    alerts.push({
      severity: "warn",
      code: "drawdown_warn",
      message: `${asset}: DD ${(todayActual.cumulativeReturn * 100).toFixed(1)}% ≤ -${(config.drawdownWarn * 100).toFixed(0)}% (warning only)`,
    });
  }

  return alerts;
}

export async function readApiKeyError(
  prisma: PrismaClient,
  asset: string,
): Promise<boolean> {
  const recent = await prisma.orderLog.findFirst({
    where: { asset, status: "failed" },
    orderBy: { submittedAt: "desc" },
  });
  if (!recent?.errorMessage) return false;
  return /HTTP 401|HTTP 403|unauthoriz|invalid.*key/i.test(recent.errorMessage);
}
