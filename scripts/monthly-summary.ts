/**
 * Monthly operations summary for the Phase 2 production run.
 *
 * Answers the questions a human actually needs once a month:
 *   - did the strategy beat buy & hold this month (JPY basis)?
 *   - how much capital was actually working (avg position)?
 *   - is the execution path still healthy (fill rate, fee, slippage, failures)?
 *   - is actual still tracking virtual?
 *
 * Portfolio-level TWR comes from ActualPortfolioState.cumulativeReturn, which
 * execution-adapter already computes deposit-netted on total equity. The row of
 * the longest-running asset (the one present at portfolio inception) carries the
 * portfolio series; later-added assets restart at 0 on their first day.
 *
 * Usage:
 *   npx tsx scripts/monthly-summary.ts               # previous month (JST)
 *   npx tsx scripts/monthly-summary.ts --month=2026-07
 */
import { PrismaClient } from "@prisma/client";
import type { ActualPortfolioState } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const JST = "Asia/Tokyo";

interface CliArgs {
  month: string; // YYYY-MM
}

function parseArgs(): CliArgs {
  let month = dayjs().tz(JST).subtract(1, "month").format("YYYY-MM");
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--month=")) {
      const v = a.slice("--month=".length);
      if (!/^\d{4}-\d{2}$/.test(v)) {
        throw new Error(`--month must be YYYY-MM, got: ${v}`);
      }
      month = v;
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return { month };
}

function pct(x: number, digits = 2): string {
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;
}

function jpy(x: number): string {
  return `¥${Math.round(x).toLocaleString("ja-JP")}`;
}

function ymd(d: Date): string {
  return dayjs(d).format("YYYY-MM-DD");
}

/** Groups rows by date string, preserving ascending date order. */
function byDate(rows: ActualPortfolioState[]): Map<string, ActualPortfolioState[]> {
  const m = new Map<string, ActualPortfolioState[]>();
  for (const r of rows) {
    const k = ymd(r.date);
    const bucket = m.get(k);
    if (bucket) bucket.push(r);
    else m.set(k, [r]);
  }
  return m;
}

async function main(): Promise<void> {
  const { month } = parseArgs();
  const start = dayjs(`${month}-01`).startOf("month").toDate();
  const end = dayjs(`${month}-01`).endOf("month").toDate();

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.actualPortfolioState.findMany({
      where: { date: { gte: start, lte: end } },
      orderBy: { date: "asc" },
    });

    if (rows.length === 0) {
      console.log(`No ActualPortfolioState rows for ${month}.`);
      return;
    }

    const dayMap = byDate(rows);
    const days = Array.from(dayMap.keys()).sort();
    const firstDay = days[0];
    const lastDay = days[days.length - 1];
    const firstRows = dayMap.get(firstDay) ?? [];
    const lastRows = dayMap.get(lastDay) ?? [];

    const sumEquity = (rs: ActualPortfolioState[]): number =>
      rs.reduce((s, r) => s + r.equityJpy, 0);
    const startEquity = sumEquity(firstRows);
    const endEquity = sumEquity(lastRows);

    const assets = Array.from(new Set(rows.map((r) => r.asset))).sort();

    // --- Portfolio TWR -------------------------------------------------------
    // Use the asset present on both the first and the last day with the longest
    // history; its cumulativeReturn is the portfolio series.
    const anchor = await pickAnchorAsset(prisma, assets);
    const anchorFirst = firstRows.find((r) => r.asset === anchor);
    const anchorLast = lastRows.find((r) => r.asset === anchor);
    const twr =
      anchorFirst && anchorLast
        ? (1 + anchorLast.cumulativeReturn) / (1 + anchorFirst.cumulativeReturn) - 1
        : null;

    const deposits = await prisma.depositEvent.aggregate({
      _sum: { amountJpy: true },
      where: { date: { gte: start, lte: end } },
    });
    const depositJpy = deposits._sum.amountJpy ?? 0;

    console.log(`\n=== Monthly Summary — ${month} (${firstDay} … ${lastDay}) ===\n`);

    console.log(`## Equity`);
    console.log(`| 項目 | 値 |`);
    console.log(`|---|---|`);
    console.log(`| 期首 equity | ${jpy(startEquity)} |`);
    console.log(`| 期末 equity | ${jpy(endEquity)} |`);
    console.log(`| 入金 | ${jpy(depositJpy)} |`);
    console.log(`| 期間リターン (TWR) | ${twr !== null ? pct(twr) : "—"} |`);
    console.log(`| 運用開始来 (TWR) | ${anchorLast ? pct(anchorLast.cumulativeReturn) : "—"} |`);

    // --- Buy & hold benchmark (JPY, GMO price series) -------------------------
    console.log(`\n## Buy & Hold 対比（JPY 建て）`);
    console.log(`| 資産 | 期首価格 | 期末価格 | BH リターン |`);
    console.log(`|---|---|---|---|`);
    const bhReturns: number[] = [];
    for (const asset of assets) {
      const series = rows.filter((r) => r.asset === asset && r.price > 0);
      if (series.length < 2) continue;
      const p0 = series[0].price;
      const p1 = series[series.length - 1].price;
      const bh = p1 / p0 - 1;
      bhReturns.push(bh);
      console.log(`| ${asset} | ${jpy(p0)} | ${jpy(p1)} | ${pct(bh)} |`);
    }
    if (bhReturns.length > 0 && twr !== null) {
      const bhAvg = bhReturns.reduce((s, x) => s + x, 0) / bhReturns.length;
      console.log(`| **等加重 BH** | | | **${pct(bhAvg)}** |`);
      console.log(`\n**アルファ (戦略 − 等加重 BH): ${pct(twr - bhAvg)}**`);
    }

    // --- Capital utilisation -------------------------------------------------
    console.log(`\n## ポジション / 資本稼働`);
    console.log(`| 資産 | 平均 target | 平均 actual | 最大 actual | rebalance 日数 | 観測日数 |`);
    console.log(`|---|---|---|---|---|---|`);
    for (const asset of assets) {
      const series = rows.filter((r) => r.asset === asset);
      const avg = (xs: number[]): number =>
        xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
      const avgTarget = avg(series.map((r) => r.targetPosition));
      const avgActual = avg(series.map((r) => r.actualPosition));
      const maxActual = Math.max(...series.map((r) => r.actualPosition));
      const rebDays = series.filter((r) => r.rebalancedToday).length;
      console.log(
        `| ${asset} | ${(avgTarget * 100).toFixed(1)}% | ${(avgActual * 100).toFixed(1)}% | ` +
          `${(maxActual * 100).toFixed(1)}% | ${rebDays} | ${series.length} |`,
      );
    }

    // --- Execution health ----------------------------------------------------
    const orders = await prisma.orderLog.findMany({
      where: { submittedAt: { gte: start, lte: end } },
      orderBy: { submittedAt: "asc" },
    });
    const submitted = orders.filter((o) => o.status === "submitted");
    const filled = orders.filter((o) => o.status === "filled");
    const failed = orders.filter((o) => o.status === "failed");
    const limitSubmitted = submitted.filter((o) => o.orderType === "LIMIT");
    const limitFilled = filled.filter((o) => o.orderType === "LIMIT");
    const marketFilled = filled.filter((o) => o.orderType === "MARKET");

    const notional = filled.reduce(
      (s, o) => s + (o.execUnits ?? 0) * (o.execPrice ?? 0),
      0,
    );
    const feeTotal = filled.reduce((s, o) => s + (o.feeJpy ?? 0), 0);
    const effFeeBps = notional > 0 ? (feeTotal / notional) * 10000 : 0;

    const marketSlips = rows
      .filter((r) => r.rebalancedToday)
      .map((r) => Math.abs(r.slippageBps));
    const avgSlip =
      marketSlips.length > 0
        ? marketSlips.reduce((s, x) => s + x, 0) / marketSlips.length
        : 0;
    const maxSlip = marketSlips.length > 0 ? Math.max(...marketSlips) : 0;

    console.log(`\n## 執行`);
    console.log(`| 項目 | 値 | 基準 |`);
    console.log(`|---|---|---|`);
    console.log(
      `| 発注数 (submitted) | ${submitted.length} 件（LIMIT ${limitSubmitted.length} / MARKET ${submitted.length - limitSubmitted.length}） | — |`,
    );
    console.log(
      `| 約定 | ${filled.length} 件（LIMIT ${limitFilled.length} / MARKET ${marketFilled.length}） | — |`,
    );
    console.log(
      `| Maker LIMIT fill 率 | ${limitSubmitted.length > 0 ? ((limitFilled.length / limitSubmitted.length) * 100).toFixed(1) + "%" : "—"} | ≥30% |`,
    );
    console.log(
      `| Effective fee | ${effFeeBps >= 0 ? "+" : ""}${effFeeBps.toFixed(2)}bps（${jpy(feeTotal)} / ${jpy(notional)}） | ≤+5bps |`,
    );
    console.log(
      `| Slippage | avg ${avgSlip.toFixed(1)}bps / max ${maxSlip.toFixed(1)}bps | ≤30bps |`,
    );
    console.log(`| 発注失敗 | ${failed.length} 件 | 0 |`);

    const skips = rows.filter((r) => r.skipReason);
    if (skips.length > 0) {
      const counts = new Map<string, number>();
      for (const r of skips) {
        const key = r.skipReason ?? "unknown";
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      console.log(`\n### Skip 理由`);
      for (const [reason, n] of Array.from(counts.entries()).sort(
        (a, b) => b[1] - a[1],
      )) {
        console.log(`- ${reason}: ${n} 件`);
      }
    }

    // --- Virtual vs actual ---------------------------------------------------
    const virtualRows = await prisma.virtualPortfolioState.findMany({
      where: { date: { gte: start, lte: end } },
      orderBy: { date: "asc" },
    });
    if (virtualRows.length > 0) {
      console.log(`\n## Virtual vs Actual`);
      console.log(
        `_Actual の cumret は portfolio 全体の TWR（資産別ではない）。資産ごとの差は起点日の違いによる。_`,
      );
      console.log(`| 資産 | Virtual 期間 | Actual 期間 | 差分 (pp) |`);
      console.log(`|---|---|---|---|`);
      for (const asset of assets) {
        const vs = virtualRows.filter((r) => r.asset === `${asset}-USD`);
        const as = rows.filter((r) => r.asset === asset);
        if (vs.length < 2 || as.length < 2) continue;
        const vRet =
          (1 + vs[vs.length - 1].cumulativeReturn) / (1 + vs[0].cumulativeReturn) - 1;
        const aRet =
          (1 + as[as.length - 1].cumulativeReturn) / (1 + as[0].cumulativeReturn) - 1;
        console.log(
          `| ${asset} | ${pct(vRet)} | ${pct(aRet)} | ${((aRet - vRet) * 100).toFixed(2)} |`,
        );
      }
    }

    console.log(``);
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Picks the asset whose ActualPortfolioState history reaches furthest back — its
 * cumulativeReturn is the uninterrupted portfolio TWR series.
 */
async function pickAnchorAsset(
  prisma: PrismaClient,
  assets: string[],
): Promise<string> {
  let anchor = assets[0];
  let oldest: Date | null = null;
  for (const asset of assets) {
    const first = await prisma.actualPortfolioState.findFirst({
      where: { asset },
      orderBy: { date: "asc" },
      select: { date: true },
    });
    if (!first) continue;
    if (oldest === null || first.date < oldest) {
      oldest = first.date;
      anchor = asset;
    }
  }
  return anchor;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
