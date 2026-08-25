/**
 * Backtest Funding Rate Arbitrage Strategy
 *
 * グリッドは年率基準（2026-07-18 訂正）に準拠:
 * - entry 閾値: 年率 5〜20% 相当（0.0046〜0.0183%/8h）
 *   ※ 旧グリッド 0.05〜0.3%/8h は年率 55〜329% 相当で一度も発火しない（KOH-641）
 * - round-trip コスト控除: 0.10%（楽観: GMO maker + Binance taker 往復）/ 0.20%（保守: スプレッド込み）
 * - 対象: BTCUSDT / ETHUSDT、全期間 + 直近90日
 */

import { PrismaClient } from '@prisma/client';
import { FundingArbEngine, BacktestResult } from '../src/backtest/funding-arb-engine.js';

const prisma = new PrismaClient();

// entry: 年率 5 / 7.5 / 10 / 12.5 / 15 / 20% 相当（%/8h）
const ENTRY_THRESHOLDS = [0.000046, 0.000068, 0.000091, 0.000114, 0.000137, 0.000183];
// exit: 年率 -5 / 0 / 2.5 / 5% 相当
const EXIT_THRESHOLDS = [-0.000046, 0, 0.000023, 0.000046];
const AVG_DAYS_LIST = [3, 5, 7];
const INITIAL_CAPITAL = 100000; // ¥100,000
const ROUND_TRIP_COSTS = [0.1, 0.2]; // % of capital per trade

const annualPct = (r8h: number) => r8h * 3 * 365 * 100;

interface NetResult {
  result: BacktestResult;
  netAnnualized: number[]; // ROUND_TRIP_COSTS と同順
}

async function runGrid(symbol: string, label: string, since?: Date): Promise<void> {
  const fundingRates = await prisma.fundingRateDetail.findMany({
    where: { symbol, ...(since ? { timestamp: { gte: since } } : {}) },
    orderBy: { timestamp: 'asc' },
    select: { timestamp: true, rate: true },
  });

  const days = fundingRates.length / 3; // 8時間ごと3期間/日
  console.log(`\n${'='.repeat(100)}`);
  console.log(`${symbol} — ${label} (${fundingRates.length} periods, ${days.toFixed(0)} days)`);
  console.log('='.repeat(100));

  if (fundingRates.length === 0) {
    console.log('  No funding rate data. Run scripts/backfill-funding-rates.ts first.');
    return;
  }

  const engine = new FundingArbEngine();
  const results = engine.gridSearch(
    fundingRates,
    ENTRY_THRESHOLDS,
    EXIT_THRESHOLDS,
    AVG_DAYS_LIST,
    INITIAL_CAPITAL
  );

  // コスト控除後のネット年率で評価（保守コストでソート）
  const netResults: NetResult[] = results.map((result) => ({
    result,
    netAnnualized: ROUND_TRIP_COSTS.map((cost) => {
      const netTotal = result.totalReturn - result.totalTrades * cost;
      return (netTotal / days) * 365;
    }),
  }));
  netResults.sort((a, b) => b.netAnnualized[1] - a.netAnnualized[1]);

  console.log(
    '\nentry(年率)  exit(年率)  avgD | trades hold% Sharpe | gross年率 | ' +
      ROUND_TRIP_COSTS.map((c) => `net年率(cost${c.toFixed(1)}%)`).join(' ')
  );
  for (const { result: r, netAnnualized } of netResults.slice(0, 8)) {
    const p = r.params;
    console.log(
      `${annualPct(p.entryThreshold).toFixed(1).padStart(9)}% ` +
        `${annualPct(p.exitThreshold).toFixed(1).padStart(9)}% ` +
        `${String(p.avgDays).padStart(4)}d | ` +
        `${String(r.totalTrades).padStart(5)} ${r.positionHoldPercent.toFixed(0).padStart(4)}% ` +
        `${r.sharpeRatio.toFixed(2).padStart(6)} | ` +
        `${r.annualizedReturn.toFixed(2).padStart(8)}% | ` +
        netAnnualized.map((n) => `${n.toFixed(2).padStart(14)}%`).join(' ')
    );
  }

  const best = netResults[0];
  const bp = best.result.params;
  console.log(
    `\n🏆 BEST (net, cost ${ROUND_TRIP_COSTS[1]}%): ` +
      `entry ${bp.avgDays}d MA > ${annualPct(bp.entryThreshold).toFixed(1)}%年率 / ` +
      `exit < ${annualPct(bp.exitThreshold).toFixed(1)}%年率 → ` +
      `net ${best.netAnnualized[1].toFixed(2)}%/yr (gross ${best.result.annualizedReturn.toFixed(2)}%, ` +
      `${best.result.totalTrades} trades, hold ${best.result.positionHoldPercent.toFixed(0)}%)`
  );
}

async function main() {
  console.log('Running Funding Rate Arbitrage Backtest...');
  console.log(`Entry grid: ${ENTRY_THRESHOLDS.map((t) => annualPct(t).toFixed(1) + '%').join(', ')} (年率換算)`);
  console.log(`Exit grid:  ${EXIT_THRESHOLDS.map((t) => annualPct(t).toFixed(1) + '%').join(', ')} (年率換算)`);
  console.log(`Avg days:   ${AVG_DAYS_LIST.join(', ')}`);
  console.log(`Round-trip costs: ${ROUND_TRIP_COSTS.map((c) => c.toFixed(1) + '%').join(' / ')} of capital per trade`);

  const since90 = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  for (const symbol of ['BTCUSDT', 'ETHUSDT']) {
    await runGrid(symbol, '全期間', undefined);
    await runGrid(symbol, '直近90日', since90);
  }

  console.log('\n✓ Backtest complete!');
}

main()
  .catch((error) => {
    console.error('Error running backtest:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
