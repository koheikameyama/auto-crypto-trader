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
 * Collection and rendering are kept apart so the same numbers can go to a
 * terminal (markdown) or to Slack (mrkdwn — no table support, so tabular blocks
 * are aligned inside code fences).
 *
 * Usage:
 *   npx tsx scripts/monthly-summary.ts                    # previous month (JST)
 *   npx tsx scripts/monthly-summary.ts --month=2026-07
 *   npx tsx scripts/monthly-summary.ts --format=slack
 */
import { PrismaClient } from "@prisma/client";
import type { ActualPortfolioState } from "@prisma/client";
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc.js";
import timezone from "dayjs/plugin/timezone.js";
import { monoTable } from "../src/lib/text-table.js";

dayjs.extend(utc);
dayjs.extend(timezone);

const JST = "Asia/Tokyo";

/** Phase 2.2 acceptance thresholds (docs/plans/2026-05-12-phase-2-2-small.md). */
const CRITERIA = {
  fillRate: 0.30,
  effFeeBps: 5,
  slippageBps: 30,
} as const;

type OutputFormat = "markdown" | "slack";

interface CliArgs {
  month: string; // YYYY-MM
  format: OutputFormat;
}

function parseArgs(): CliArgs {
  let month = dayjs().tz(JST).subtract(1, "month").format("YYYY-MM");
  let format: OutputFormat = "markdown";
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--month=")) {
      const v = a.slice("--month=".length);
      if (!/^\d{4}-\d{2}$/.test(v)) {
        throw new Error(`--month must be YYYY-MM, got: ${v}`);
      }
      month = v;
    } else if (a.startsWith("--format=")) {
      const v = a.slice("--format=".length);
      if (v !== "markdown" && v !== "slack") {
        throw new Error(`--format must be markdown|slack, got: ${v}`);
      }
      format = v;
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return { month, format };
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function pct(x: number, digits = 2): string {
  return `${x >= 0 ? "+" : ""}${(x * 100).toFixed(digits)}%`;
}

function jpy(x: number): string {
  return `¥${Math.round(x).toLocaleString("ja-JP")}`;
}

function ymd(d: Date): string {
  return dayjs(d).format("YYYY-MM-DD");
}

function mdTable(headers: string[], rows: string[][]): string {
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

function mark(ok: boolean): string {
  return ok ? "✅" : "⚠️";
}

// ---------------------------------------------------------------------------
// Data collection
// ---------------------------------------------------------------------------

interface BhRow {
  asset: string;
  p0: number;
  p1: number;
  ret: number;
}

interface PositionRow {
  asset: string;
  avgTarget: number;
  avgActual: number;
  maxActual: number;
  rebDays: number;
  days: number;
}

interface ExecStats {
  submitted: number;
  submittedLimit: number;
  submittedMarket: number;
  filled: number;
  filledLimit: number;
  filledMarket: number;
  fillRate: number | null;
  feeTotal: number;
  notional: number;
  effFeeBps: number;
  avgSlip: number;
  maxSlip: number;
  failed: number;
}

interface VsVirtualRow {
  asset: string;
  vRet: number;
  aRet: number;
}

interface SummaryData {
  month: string;
  firstDay: string;
  lastDay: string;
  startEquity: number;
  endEquity: number;
  depositJpy: number;
  twr: number | null;
  inceptionTwr: number | null;
  bh: BhRow[];
  bhAvg: number | null;
  positions: PositionRow[];
  exec: ExecStats;
  skips: { reason: string; count: number }[];
  vsVirtual: VsVirtualRow[];
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

function avg(xs: number[]): number {
  return xs.length > 0 ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
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

async function collect(
  prisma: PrismaClient,
  month: string,
): Promise<SummaryData | null> {
  const start = dayjs(`${month}-01`).startOf("month").toDate();
  const end = dayjs(`${month}-01`).endOf("month").toDate();

  const rows = await prisma.actualPortfolioState.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: { date: "asc" },
  });
  if (rows.length === 0) return null;

  const dayMap = byDate(rows);
  const days = Array.from(dayMap.keys()).sort();
  const firstDay = days[0];
  const lastDay = days[days.length - 1];
  const firstRows = dayMap.get(firstDay) ?? [];
  const lastRows = dayMap.get(lastDay) ?? [];

  const sumEquity = (rs: ActualPortfolioState[]): number =>
    rs.reduce((s, r) => s + r.equityJpy, 0);

  const assets = Array.from(new Set(rows.map((r) => r.asset))).sort();
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

  // Buy & hold benchmark from the GMO JPY price series.
  const bh: BhRow[] = [];
  for (const asset of assets) {
    const series = rows.filter((r) => r.asset === asset && r.price > 0);
    if (series.length < 2) continue;
    const p0 = series[0].price;
    const p1 = series[series.length - 1].price;
    bh.push({ asset, p0, p1, ret: p1 / p0 - 1 });
  }

  const positions: PositionRow[] = assets.map((asset) => {
    const series = rows.filter((r) => r.asset === asset);
    return {
      asset,
      avgTarget: avg(series.map((r) => r.targetPosition)),
      avgActual: avg(series.map((r) => r.actualPosition)),
      maxActual: Math.max(...series.map((r) => r.actualPosition)),
      rebDays: series.filter((r) => r.rebalancedToday).length,
      days: series.length,
    };
  });

  const orders = await prisma.orderLog.findMany({
    where: { submittedAt: { gte: start, lte: end } },
    orderBy: { submittedAt: "asc" },
  });
  const submitted = orders.filter((o) => o.status === "submitted");
  const filled = orders.filter((o) => o.status === "filled");
  const submittedLimit = submitted.filter((o) => o.orderType === "LIMIT");
  const filledLimit = filled.filter((o) => o.orderType === "LIMIT");
  const notional = filled.reduce(
    (s, o) => s + (o.execUnits ?? 0) * (o.execPrice ?? 0),
    0,
  );
  const feeTotal = filled.reduce((s, o) => s + (o.feeJpy ?? 0), 0);
  const slips = rows
    .filter((r) => r.rebalancedToday)
    .map((r) => Math.abs(r.slippageBps));

  const exec: ExecStats = {
    submitted: submitted.length,
    submittedLimit: submittedLimit.length,
    submittedMarket: submitted.length - submittedLimit.length,
    filled: filled.length,
    filledLimit: filledLimit.length,
    filledMarket: filled.length - filledLimit.length,
    fillRate:
      submittedLimit.length > 0 ? filledLimit.length / submittedLimit.length : null,
    feeTotal,
    notional,
    effFeeBps: notional > 0 ? (feeTotal / notional) * 10000 : 0,
    avgSlip: avg(slips),
    maxSlip: slips.length > 0 ? Math.max(...slips) : 0,
    failed: orders.filter((o) => o.status === "failed").length,
  };

  const skipCounts = new Map<string, number>();
  for (const r of rows) {
    if (!r.skipReason) continue;
    skipCounts.set(r.skipReason, (skipCounts.get(r.skipReason) ?? 0) + 1);
  }

  const virtualRows = await prisma.virtualPortfolioState.findMany({
    where: { date: { gte: start, lte: end } },
    orderBy: { date: "asc" },
  });
  const vsVirtual: VsVirtualRow[] = [];
  for (const asset of assets) {
    const vs = virtualRows.filter((r) => r.asset === `${asset}-USD`);
    const as = rows.filter((r) => r.asset === asset);
    if (vs.length < 2 || as.length < 2) continue;
    vsVirtual.push({
      asset,
      vRet: (1 + vs[vs.length - 1].cumulativeReturn) / (1 + vs[0].cumulativeReturn) - 1,
      aRet: (1 + as[as.length - 1].cumulativeReturn) / (1 + as[0].cumulativeReturn) - 1,
    });
  }

  return {
    month,
    firstDay,
    lastDay,
    startEquity: sumEquity(firstRows),
    endEquity: sumEquity(lastRows),
    depositJpy: deposits._sum.amountJpy ?? 0,
    twr,
    inceptionTwr: anchorLast ? anchorLast.cumulativeReturn : null,
    bh,
    bhAvg: bh.length > 0 ? avg(bh.map((b) => b.ret)) : null,
    positions,
    exec,
    skips: Array.from(skipCounts.entries())
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
    vsVirtual,
  };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderMarkdown(d: SummaryData): string {
  const out: string[] = [];
  out.push(`\n=== Monthly Summary — ${d.month} (${d.firstDay} … ${d.lastDay}) ===\n`);

  out.push(`## Equity`);
  out.push(
    mdTable(
      ["項目", "値"],
      [
        ["期首 equity", jpy(d.startEquity)],
        ["期末 equity", jpy(d.endEquity)],
        ["入金", jpy(d.depositJpy)],
        ["期間リターン (TWR)", d.twr !== null ? pct(d.twr) : "—"],
        ["運用開始来 (TWR)", d.inceptionTwr !== null ? pct(d.inceptionTwr) : "—"],
      ],
    ),
  );

  out.push(`\n## Buy & Hold 対比（JPY 建て）`);
  const bhRows = d.bh.map((b) => [b.asset, jpy(b.p0), jpy(b.p1), pct(b.ret)]);
  if (d.bhAvg !== null) bhRows.push(["**等加重 BH**", "", "", `**${pct(d.bhAvg)}**`]);
  out.push(mdTable(["資産", "期首価格", "期末価格", "BH リターン"], bhRows));
  if (d.bhAvg !== null && d.twr !== null) {
    out.push(`\n**アルファ (戦略 − 等加重 BH): ${pct(d.twr - d.bhAvg)}**`);
  }

  out.push(`\n## ポジション / 資本稼働`);
  out.push(
    mdTable(
      ["資産", "平均 target", "平均 actual", "最大 actual", "rebalance 日数", "観測日数"],
      d.positions.map((p) => [
        p.asset,
        `${(p.avgTarget * 100).toFixed(1)}%`,
        `${(p.avgActual * 100).toFixed(1)}%`,
        `${(p.maxActual * 100).toFixed(1)}%`,
        String(p.rebDays),
        String(p.days),
      ]),
    ),
  );

  const e = d.exec;
  out.push(`\n## 執行`);
  out.push(
    mdTable(
      ["項目", "値", "基準"],
      [
        [
          "発注数 (submitted)",
          `${e.submitted} 件（LIMIT ${e.submittedLimit} / MARKET ${e.submittedMarket}）`,
          "—",
        ],
        [
          "約定",
          `${e.filled} 件（LIMIT ${e.filledLimit} / MARKET ${e.filledMarket}）`,
          "—",
        ],
        [
          "Maker LIMIT fill 率",
          e.fillRate !== null ? `${(e.fillRate * 100).toFixed(1)}%` : "—",
          "≥30%",
        ],
        [
          "Effective fee",
          `${e.effFeeBps >= 0 ? "+" : ""}${e.effFeeBps.toFixed(2)}bps（${jpy(e.feeTotal)} / ${jpy(e.notional)}）`,
          "≤+5bps",
        ],
        [
          "Slippage",
          `avg ${e.avgSlip.toFixed(1)}bps / max ${e.maxSlip.toFixed(1)}bps`,
          "≤30bps",
        ],
        ["発注失敗", `${e.failed} 件`, "0"],
      ],
    ),
  );

  if (d.skips.length > 0) {
    out.push(`\n### Skip 理由`);
    for (const s of d.skips) out.push(`- ${s.reason}: ${s.count} 件`);
  }

  if (d.vsVirtual.length > 0) {
    out.push(`\n## Virtual vs Actual`);
    out.push(
      `_Actual の cumret は portfolio 全体の TWR（資産別ではない）。資産ごとの差は起点日の違いによる。_`,
    );
    out.push(
      mdTable(
        ["資産", "Virtual 期間", "Actual 期間", "差分 (pp)"],
        d.vsVirtual.map((v) => [
          v.asset,
          pct(v.vRet),
          pct(v.aRet),
          ((v.aRet - v.vRet) * 100).toFixed(2),
        ]),
      ),
    );
  }

  return out.join("\n") + "\n";
}

/**
 * Slack mrkdwn: no headings and no tables, so sections are bold lines and
 * tabular blocks go inside code fences where monospace keeps columns aligned.
 */
function renderSlack(d: SummaryData): string {
  const out: string[] = [];
  const fence = (body: string): string => "```\n" + body + "\n```";

  out.push(`🗓️ *Monthly Operations Summary — ${d.month}*`);
  out.push(`_${d.firstDay} 〜 ${d.lastDay}_`);

  // Headline: the two numbers worth reading first.
  if (d.twr !== null && d.bhAvg !== null) {
    const alpha = d.twr - d.bhAvg;
    out.push(
      `\n*成績:* ${pct(d.twr)} vs 等加重BH ${pct(d.bhAvg)} → アルファ *${pct(alpha)}* ${alpha >= 0 ? "🟢" : "🔴"}`,
    );
  } else if (d.twr !== null) {
    out.push(`\n*成績:* ${pct(d.twr)}`);
  }

  out.push(`\n*💰 Equity*`);
  out.push(
    fence(
      monoTable(
        ["", "金額"],
        [
          ["期首", jpy(d.startEquity)],
          ["期末", jpy(d.endEquity)],
          ["入金", jpy(d.depositJpy)],
        ],
      ) +
        `\n\n期間 TWR    ${d.twr !== null ? pct(d.twr) : "—"}` +
        `\n開始来 TWR  ${d.inceptionTwr !== null ? pct(d.inceptionTwr) : "—"}`,
    ),
  );

  if (d.bh.length > 0) {
    out.push(`*📊 Buy & Hold 対比（JPY 建て）*`);
    const rows = d.bh.map((b) => [b.asset, jpy(b.p0), jpy(b.p1), pct(b.ret)]);
    if (d.bhAvg !== null) rows.push(["等加重BH", "", "", pct(d.bhAvg)]);
    out.push(fence(monoTable(["資産", "期首", "期末", "BH"], rows)));
  }

  if (d.positions.length > 0) {
    out.push(`*⚖️ ポジション / 資本稼働*`);
    out.push(
      fence(
        monoTable(
          ["資産", "平均tgt", "平均act", "最大act", "reb", "日数"],
          d.positions.map((p) => [
            p.asset,
            `${(p.avgTarget * 100).toFixed(1)}%`,
            `${(p.avgActual * 100).toFixed(1)}%`,
            `${(p.maxActual * 100).toFixed(1)}%`,
            String(p.rebDays),
            String(p.days),
          ]),
        ),
      ),
    );
  }

  const e = d.exec;
  out.push(`*🔧 執行*`);
  out.push(
    `• 発注 ${e.submitted} 件（LIMIT ${e.submittedLimit} / MARKET ${e.submittedMarket}）→ 約定 ${e.filled} 件`,
  );
  out.push(
    `• Maker fill 率: *${e.fillRate !== null ? (e.fillRate * 100).toFixed(1) + "%" : "—"}* （基準 ≥30%） ${mark(e.fillRate === null || e.fillRate >= CRITERIA.fillRate)}`,
  );
  out.push(
    `• Effective fee: *${e.effFeeBps >= 0 ? "+" : ""}${e.effFeeBps.toFixed(2)}bps* （基準 ≤+5bps） ${mark(e.effFeeBps <= CRITERIA.effFeeBps)}`,
  );
  out.push(
    `• Slippage: avg *${e.avgSlip.toFixed(1)}bps* / max ${e.maxSlip.toFixed(1)}bps （基準 ≤30bps） ${mark(e.avgSlip <= CRITERIA.slippageBps)}`,
  );
  out.push(`• 発注失敗: *${e.failed} 件* （基準 0） ${mark(e.failed === 0)}`);

  if (d.skips.length > 0) {
    out.push(`\n*⏭️ Skip 理由*`);
    for (const s of d.skips) out.push(`• ${s.reason}: ${s.count} 件`);
  }

  if (d.vsVirtual.length > 0) {
    out.push(`\n*🔍 Virtual vs Actual*`);
    out.push(
      fence(
        monoTable(
          ["資産", "Virtual", "Actual", "差分pp"],
          d.vsVirtual.map((v) => [
            v.asset,
            pct(v.vRet),
            pct(v.aRet),
            ((v.aRet - v.vRet) * 100).toFixed(2),
          ]),
        ),
      ),
    );
    out.push(
      `_Actual の cumret は portfolio 全体の TWR。資産ごとの差は起点日の違いによる。_`,
    );
  }

  return out.join("\n") + "\n";
}

async function main(): Promise<void> {
  const { month, format } = parseArgs();
  const prisma = new PrismaClient();
  try {
    const data = await collect(prisma, month);
    if (data === null) {
      console.log(`No ActualPortfolioState rows for ${month}.`);
      return;
    }
    console.log(format === "slack" ? renderSlack(data) : renderMarkdown(data));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
