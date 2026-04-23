import { PrismaClient } from "@prisma/client";
import dayjs from "dayjs";
import { loadBars } from "../src/backtest/runner-helpers.js";
import {
  computeOnchainFeatures,
  rollingPercentile,
} from "../src/lib/onchain-indicators.js";
import { forwardFillMacro } from "../src/data/macro-loader.js";
import type { OnchainBar } from "../src/data/onchain-loader.js";
import type { FundingBar } from "../src/data/funding-loader.js";
import type { DailyBar } from "../src/types/bar.js";

async function loadOnchainBars(prisma: PrismaClient, s: Date, e: Date): Promise<OnchainBar[]> {
  const a = await prisma.asset.findUnique({ where: { symbol: "BTC-USD" } });
  if (!a) throw new Error("Asset BTC-USD not found");
  const rows = await prisma.onchainMetric.findMany({
    where: { assetId: a.id, date: { gte: s, lte: e } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({
    date: r.date,
    priceUsd: r.priceUsd,
    capMrktUsd: r.capMrktUsd,
    txCnt: r.txCnt,
    adrActCnt: r.adrActCnt,
  }));
}

async function loadMacroBars(prisma: PrismaClient, ticker: string, s: Date, e: Date): Promise<DailyBar[]> {
  const rows = await prisma.macroBar.findMany({
    where: { ticker, date: { gte: s, lte: e } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({
    date: r.date,
    open: r.open, high: r.high, low: r.low, close: r.close,
    volume: r.volume,
  }));
}

async function loadFundingBars(prisma: PrismaClient, s: Date, e: Date): Promise<FundingBar[]> {
  const rows = await prisma.fundingRate.findMany({
    where: { symbol: "BTCUSDT", date: { gte: s, lte: e } },
    orderBy: { date: "asc" },
  });
  return rows.map((r) => ({ date: r.date, avgRate: r.avgRate, count: r.count }));
}

function simpleMa(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  if (period <= 0 || values.length < period) return out;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  out[period - 1] = sum / period;
  for (let i = period; i < values.length; i++) {
    sum += values[i] - values[i - period];
    out[i] = sum / period;
  }
  return out;
}

function pearson(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) { sumX += x[i]; sumY += y[i]; }
  const mx = sumX / n, my = sumY / n;
  let cov = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    cov += dx * dy; sx += dx * dx; sy += dy * dy;
  }
  if (sx === 0 || sy === 0) return 0;
  return cov / Math.sqrt(sx * sy);
}

function percentileAligned(
  seriesDates: Date[],
  pctByTime: Map<number, number>,
  targetDates: Date[],
): (number | null)[] {
  const sortedTimes = seriesDates
    .filter((d) => pctByTime.has(d.getTime()))
    .map((d) => d.getTime())
    .sort((a, b) => a - b);
  return targetDates.map((d) => {
    const t = d.getTime();
    let lo = 0, hi = sortedTimes.length - 1, res = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (sortedTimes[mid] <= t) { res = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    return res === -1 ? null : pctByTime.get(sortedTimes[res]) ?? null;
  });
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const start = dayjs("2019-10-01");
    const end = dayjs();

    const btc = await loadBars(prisma, "BTC-USD", start.toDate(), end.toDate());
    const onchain = await loadOnchainBars(prisma, start.toDate(), end.toDate());
    const dxy = await loadMacroBars(prisma, "DX-Y.NYB", start.toDate(), end.toDate());
    const vix = await loadMacroBars(prisma, "^VIX", start.toDate(), end.toDate());
    const tnx = await loadMacroBars(prisma, "^TNX", start.toDate(), end.toDate());
    const funding = await loadFundingBars(prisma, start.toDate(), end.toDate());

    console.log(`\n========================================`);
    console.log(`Signal Correlation Analysis`);
    console.log(`Period: ${start.format("YYYY-MM-DD")} -> ${end.format("YYYY-MM-DD")} (6.5y)`);
    console.log(`========================================\n`);

    // Compute individual signal scores for each BTC date
    const btcDates = btc.map((b) => b.date);
    const feats = computeOnchainFeatures(onchain, {
      nvtLookback: 14, aaLookback: 30, percentileWindow: 365,
    });
    const featByTime = new Map<number, typeof feats[0]>();
    for (const f of feats) featByTime.set(f.date.getTime(), f);

    const dxyAligned = forwardFillMacro(dxy, btcDates);
    const vixAligned = forwardFillMacro(vix, btcDates);
    const tnxAligned = forwardFillMacro(tnx, btcDates);
    const dxyValid = dxyAligned.map((v) => (v === null ? 0 : v));
    const dxySmaRaw = simpleMa(dxyValid, 200);
    const dxySma = dxySmaRaw.map((v, i) => (dxyAligned[i] === null ? null : v));

    // TNX rolling percentile
    const tnxSeries: (number | null)[] = tnx.map((b) => b.close);
    const tnxPcts = rollingPercentile(tnxSeries, 365);
    const tnxPctByTime = new Map<number, number>();
    for (let i = 0; i < tnx.length; i++) {
      const v = tnxPcts[i];
      if (v !== null) tnxPctByTime.set(tnx[i].date.getTime(), v);
    }
    const tnxPctAligned = percentileAligned(tnx.map((b) => b.date), tnxPctByTime, btcDates);

    // Funding rolling percentile
    const fundSeries: (number | null)[] = funding.map((f) => f.avgRate);
    const fundPcts = rollingPercentile(fundSeries, 365);
    const fundPctByTime = new Map<number, number>();
    for (let i = 0; i < funding.length; i++) {
      const v = fundPcts[i];
      if (v !== null) fundPctByTime.set(funding[i].date.getTime(), v);
    }
    const fundPctAligned = percentileAligned(funding.map((f) => f.date), fundPctByTime, btcDates);

    // Compute each signal score per BTC bar (filter for valid dates only)
    interface Row {
      onchain: number;
      dxy: number;
      vix: number;
      tnx: number;
      funding: number;
      btcReturn: number;
    }
    const rows: Row[] = [];
    for (let i = 1; i < btc.length; i++) {
      const bar = btc[i];
      const feat = featByTime.get(bar.date.getTime());
      if (!feat) continue;
      if (feat.nvtPercentile === null || feat.aaMomentum === null) continue;
      const dxyV = dxyAligned[i], dxyM = dxySma[i], vixV = vixAligned[i];
      const tnxP = tnxPctAligned[i], fundP = fundPctAligned[i];
      if (dxyV === null || dxyM === null || vixV === null || tnxP === null || fundP === null) continue;

      const onchainScore = ((1 - feat.nvtPercentile) + Math.max(0, Math.min(1, (feat.aaMomentum - 0.8) / 0.4))) / 2;
      const dxyRatio = dxyV / dxyM;
      let dxyScore = 0.5;
      if (dxyRatio < 0.97) dxyScore = 1;
      else if (dxyRatio > 1.03) dxyScore = 0;
      else dxyScore = (1.03 - dxyRatio) / 0.06;

      const vixThr = 30;
      let vixScore = 0.5;
      if (vixV < vixThr * 0.7) vixScore = 1;
      else if (vixV > vixThr * 1.3) vixScore = 0;
      else vixScore = 1 - (vixV - vixThr * 0.7) / (vixThr * 0.6);

      const tnxScore = 1 - tnxP;
      const fundingScore = 1 - fundP;
      const prev = btc[i - 1].close;
      const ret = (bar.close - prev) / prev;

      rows.push({ onchain: onchainScore, dxy: dxyScore, vix: vixScore, tnx: tnxScore, funding: fundingScore, btcReturn: ret });
    }

    console.log(`Valid rows for correlation: ${rows.length}\n`);

    // Pairwise correlation
    const signals = ["onchain", "dxy", "vix", "tnx", "funding"] as const;
    console.log(`=== Pairwise Signal Correlation (Pearson) ===\n`);
    console.log(`         ${signals.map((s) => s.padStart(8)).join(" ")}`);
    for (const a of signals) {
      const row: string[] = [];
      for (const b of signals) {
        const xa = rows.map((r) => r[a]);
        const xb = rows.map((r) => r[b]);
        row.push(pearson(xa, xb).toFixed(3).padStart(8));
      }
      console.log(`${a.padStart(8)} ${row.join(" ")}`);
    }

    // Signal vs forward-looking BTC return correlation
    console.log(`\n=== Signal Score vs BTC Next-Day Return Correlation ===\n`);
    for (const s of signals) {
      const xs = rows.slice(0, -1).map((r) => r[s]);
      const ys = rows.slice(1).map((r) => r.btcReturn);
      console.log(`${s.padStart(8)}: ${pearson(xs, ys).toFixed(4)}`);
    }

    // Signal vs 30-day forward BTC return (more interesting for regime signals)
    console.log(`\n=== Signal Score vs BTC 30-Day Forward Return ===\n`);
    for (const s of signals) {
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < rows.length - 30; i++) {
        const r0 = rows[i], r30 = rows[i + 30];
        // Reconstruct the 30-day compounded return from daily returns
        let cum = 1;
        for (let j = i + 1; j <= i + 30; j++) cum *= 1 + rows[j].btcReturn;
        xs.push(r0[s]);
        ys.push(cum - 1);
        void r30;
      }
      console.log(`${s.padStart(8)}: ${pearson(xs, ys).toFixed(4)}`);
    }

    console.log(`\n=== Interpretation ===`);
    console.log(`- |corr| > 0.7: strongly collinear → drop one or reduce weight`);
    console.log(`- |corr| 0.4-0.7: moderate overlap → careful weight tuning`);
    console.log(`- |corr| < 0.4: independent signals → combine freely`);
    console.log(`- Signal vs forward return: higher abs value = more predictive`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
