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
 * Pre-execution guard. Returns `{ ok: false, reason }` if any stop condition
 * is met; caller must skip the actual execution for the day.
 *
 * Conditions:
 *   1. Last N consecutive OrderLog entries for this asset all `status=failed`
 *   2. Latest ActualPortfolioState's cumulativeReturn ≤ -maxDrawdown
 */
export async function checkKillSwitch(
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

  const latest = await prisma.actualPortfolioState.findFirst({
    where: { asset },
    orderBy: { date: "desc" },
  });
  if (latest && latest.cumulativeReturn <= -config.maxDrawdown) {
    return {
      ok: false,
      reason: `drawdown ${(latest.cumulativeReturn * 100).toFixed(1)}% ≤ -${(config.maxDrawdown * 100).toFixed(0)}%`,
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
