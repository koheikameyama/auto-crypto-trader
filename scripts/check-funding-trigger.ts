/**
 * Watches the Phase 3 funding-arb re-entry condition so it does not have to be
 * measured by hand.
 *
 * FundingRate.avgRate is the daily average of the per-8h funding rate, so the
 * annualised figure is rate * 3 * 365.
 *
 * Thresholds (docs/specs/phase3-funding-arb-analysis.md, CLAUDE.md):
 *   早期警戒  年率 10% = 0.0091%/8h  → backtest を先行実行する合図
 *   再開検討  年率 15% = 0.0137%/8h  → Phase 3 再開の検討ライン
 *
 * Prints a one-line status per symbol and exits 0 always; `--alert-only`
 * suppresses output entirely when nothing crosses a threshold, so the caller can
 * decide whether to notify by checking whether stdout is empty.
 *
 * Usage:
 *   npx tsx scripts/check-funding-trigger.ts
 *   npx tsx scripts/check-funding-trigger.ts --alert-only --window=3
 */
import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { monoTable } from "../src/lib/text-table.js";

/** Funding is paid 3x per day. */
const INTERVALS_PER_YEAR = 3 * 365;

const EARLY_WARN_ANNUAL = 0.10; // 年率 10% — backtest 先行実行ライン
const REENTRY_ANNUAL = 0.15; // 年率 15% — Phase 3 再開検討ライン

const SYMBOLS = ["BTCUSDT", "ETHUSDT"];

interface CliArgs {
  window: number;
  alertOnly: boolean;
}

function parseArgs(): CliArgs {
  let window = 3;
  let alertOnly = false;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith("--window=")) {
      window = Number(a.slice("--window=".length));
      if (!Number.isFinite(window) || window < 1) {
        throw new Error(`--window must be a positive integer, got: ${a}`);
      }
    } else if (a === "--alert-only") {
      alertOnly = true;
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return { window, alertOnly };
}

function annualise(ratePer8h: number): number {
  return ratePer8h * INTERVALS_PER_YEAR;
}

interface SymbolStatus {
  symbol: string;
  ma: number; // window-day moving average of the per-8h rate
  annual: number;
  latestDate: string;
  samples: number;
  level: "none" | "early" | "reentry";
}

async function main(): Promise<void> {
  const { window, alertOnly } = parseArgs();
  const prisma = new PrismaClient();
  try {
    const statuses: SymbolStatus[] = [];

    for (const symbol of SYMBOLS) {
      const bars = await prisma.fundingRate.findMany({
        where: { symbol },
        orderBy: { date: "desc" },
        take: window,
      });
      if (bars.length === 0) continue;

      const ma = bars.reduce((s, b) => s + b.avgRate, 0) / bars.length;
      const annual = annualise(ma);
      const level: SymbolStatus["level"] =
        annual >= REENTRY_ANNUAL
          ? "reentry"
          : annual >= EARLY_WARN_ANNUAL
            ? "early"
            : "none";

      statuses.push({
        symbol,
        ma,
        annual,
        latestDate: dayjs(bars[0].date).format("YYYY-MM-DD"),
        samples: bars.length,
        level,
      });
    }

    const triggered = statuses.filter((s) => s.level !== "none");
    if (alertOnly && triggered.length === 0) return;

    const header = triggered.some((s) => s.level === "reentry")
      ? `🚨 *Phase 3 再開検討ライン到達* — funding ${window} 日移動平均が年率 ${(REENTRY_ANNUAL * 100).toFixed(0)}% 超`
      : triggered.length > 0
        ? `⚠️ *Phase 3 早期警戒ライン到達* — funding ${window} 日移動平均が年率 ${(EARLY_WARN_ANNUAL * 100).toFixed(0)}% 超`
        : `*Funding trigger check* — ${window} 日移動平均（閾値未達）`;

    console.log(header);

    // Slack renders neither markdown tables nor headings, so the numbers go into
    // a code fence where monospace keeps the columns aligned.
    const rows = statuses.map((s) => [
      s.symbol,
      `${(s.ma * 100).toFixed(4)}%`,
      `${(s.annual * 100).toFixed(2)}%`,
      s.level === "reentry" ? "🚨 再開検討" : s.level === "early" ? "⚠️ 早期警戒" : "— 未達",
      s.samples < window ? `${s.latestDate} (${s.samples}/${window}d)` : s.latestDate,
    ]);
    console.log("```");
    console.log(monoTable([`Symbol`, `${window}d MA`, `年率`, `判定`, `最新`], rows));
    console.log("```");

    console.log(
      `_基準: 早期警戒 年率 ${(EARLY_WARN_ANNUAL * 100).toFixed(0)}% / 再開検討 年率 ${(REENTRY_ANNUAL * 100).toFixed(0)}%_`,
    );

    if (triggered.length > 0) {
      console.log("");
      console.log(
        `*次アクション:* \`docs/specs/phase3-funding-arb-analysis.md\` の再開条件を確認し、` +
          `backtest（\`scripts/backtest-funding-arb.ts\`）を実行。` +
          `Binance 署名付き API の -2015 ブロッカーが未解消な点に注意。`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
