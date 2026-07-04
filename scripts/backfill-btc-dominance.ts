import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * BTC.D (BTC dominance) historical backfill from TradingView CSV export.
 *
 * Round 13 prerequisite — see docs/plans/2026-05-21-round-13-btcd-overlay.md
 *
 * Source: TradingView → CRYPTOCAP:BTC.D → Export chart data → CSV
 * Default expected CSV path: data/btc-dominance.csv (gitignored)
 *
 * TradingView CSV header (typical):
 *   time,open,high,low,close,Volume,Volume MA
 * where `time` is either a Unix timestamp (seconds) or ISO-8601.
 *
 * Stored as MacroBar with ticker="BTC.D", same as daily-data-collection.ts.
 * Uses createMany + skipDuplicates so it is safe to re-run.
 *
 * Usage:
 *   npx tsx scripts/backfill-btc-dominance.ts                       # default path
 *   npx tsx scripts/backfill-btc-dominance.ts data/btc-dom-2026.csv # custom path
 *   npx tsx scripts/backfill-btc-dominance.ts --dry-run             # parse only
 */

interface ParsedRow {
  date: Date;
  open: number;
  high: number;
  low: number;
  close: number;
}

function parseTimestamp(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Unix seconds
  if (/^\d{9,11}$/.test(trimmed)) {
    return dayjs.unix(Number(trimmed)).startOf("day").toDate();
  }
  // Unix millis
  if (/^\d{12,14}$/.test(trimmed)) {
    return dayjs(Number(trimmed)).startOf("day").toDate();
  }
  // ISO or YYYY-MM-DD
  const d = dayjs(trimmed);
  if (!d.isValid()) return null;
  return d.startOf("day").toDate();
}

function parseCsv(content: string): ParsedRow[] {
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((s) => s.trim().toLowerCase());
  const idx = {
    time: header.findIndex((h) => h === "time" || h === "date" || h === "timestamp"),
    open: header.indexOf("open"),
    high: header.indexOf("high"),
    low: header.indexOf("low"),
    close: header.indexOf("close"),
  };
  if (idx.time < 0 || idx.close < 0) {
    throw new Error(
      `CSV header missing required columns. Got: ${header.join(",")}`,
    );
  }

  const rows: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const date = parseTimestamp(cols[idx.time] ?? "");
    if (!date) continue;
    const close = Number(cols[idx.close]);
    if (!Number.isFinite(close)) continue;
    const open = idx.open >= 0 ? Number(cols[idx.open]) : close;
    const high = idx.high >= 0 ? Number(cols[idx.high]) : close;
    const low = idx.low >= 0 ? Number(cols[idx.low]) : close;
    rows.push({
      date,
      open: Number.isFinite(open) ? open : close,
      high: Number.isFinite(high) ? high : close,
      low: Number.isFinite(low) ? low : close,
      close,
    });
  }
  return rows;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const pathArg = args.find((a) => !a.startsWith("--"));
  const csvPath = resolve(pathArg ?? "data/btc-dominance.csv");

  console.log(`BTC.D backfill from: ${csvPath}${dryRun ? " (dry-run)" : ""}`);

  const content = await readFile(csvPath, "utf8");
  const rows = parseCsv(content);
  if (rows.length === 0) {
    console.error("No usable rows parsed from CSV.");
    process.exitCode = 1;
    return;
  }

  rows.sort((a, b) => a.date.getTime() - b.date.getTime());
  const first = rows[0].date;
  const last = rows[rows.length - 1].date;
  const spanDays = dayjs(last).diff(first, "day") + 1;
  const coverage = ((rows.length / spanDays) * 100).toFixed(1);

  console.log(
    `  parsed ${rows.length} rows: ${dayjs(first).format("YYYY-MM-DD")} → ${dayjs(last).format("YYYY-MM-DD")} (coverage ${coverage}% of ${spanDays}d)`,
  );
  console.log(
    `  sample: open=${rows[0].open} close=${rows[0].close} (first), close=${rows[rows.length - 1].close} (last)`,
  );

  if (dryRun) {
    console.log("Dry run — no DB writes.");
    return;
  }

  const prisma = new PrismaClient();
  try {
    const result = await prisma.macroBar.createMany({
      data: rows.map((r) => ({
        ticker: "BTC.D",
        date: r.date,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
      })),
      skipDuplicates: true,
    });
    const total = await prisma.macroBar.count({ where: { ticker: "BTC.D" } });
    console.log(`  inserted ${result.count} new rows`);
    console.log(`  total BTC.D rows in DB: ${total}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
