import type { DailyBar } from "../types/bar.js";
import type { AssetSymbol } from "../types/asset.js";

/**
 * Daily OHLC for BTC/ETH with Binance kline as primary, CoinGecko as
 * fallback. Binance public API is reliable for most clients but blocks
 * some cloud IPs (HTTP 451 from GitHub Actions runners has been
 * observed). CoinGecko free tier is geographically unrestricted.
 *
 * Symbol mapping:
 *   BTC-USD → Binance:BTCUSDT / CoinGecko:bitcoin
 *   ETH-USD → Binance:ETHUSDT / CoinGecko:ethereum
 */

const BINANCE_KLINE_URL = "https://api.binance.com/api/v3/klines";
const KLINE_LIMIT = 1000;
const COINGECKO_BASE_URL = "https://api.coingecko.com/api/v3/coins";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type BinanceKline = [
  number, // 0: open time (ms)
  string, // 1: open
  string, // 2: high
  string, // 3: low
  string, // 4: close
  string, // 5: volume (base asset)
  number, // 6: close time (ms)
  string, // 7: quote asset volume
  number, // 8: trades
  string, // 9: taker buy base
  string, // 10: taker buy quote
  string, // 11: ignore
];

function toBinanceSymbol(asset: AssetSymbol): string {
  switch (asset) {
    case "BTC-USD":
      return "BTCUSDT";
    case "ETH-USD":
      return "ETHUSDT";
    default:
      throw new Error(`Unsupported asset for Binance: ${asset}`);
  }
}

function toCoingeckoId(asset: AssetSymbol): string {
  switch (asset) {
    case "BTC-USD":
      return "bitcoin";
    case "ETH-USD":
      return "ethereum";
    default:
      throw new Error(`Unsupported asset for CoinGecko: ${asset}`);
  }
}

function toMs(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`);
}

async function fetchFromBinance(
  asset: AssetSymbol,
  startIso: string,
  endIso: string,
): Promise<DailyBar[]> {
  const symbol = toBinanceSymbol(asset);
  const startMs = toMs(startIso);
  const endMs = toMs(endIso) + MS_PER_DAY - 1;

  const allBars: DailyBar[] = [];
  let cursor = startMs;

  while (cursor <= endMs) {
    const params = new URLSearchParams({
      symbol,
      interval: "1d",
      startTime: String(cursor),
      endTime: String(endMs),
      limit: String(KLINE_LIMIT),
    });
    const url = `${BINANCE_KLINE_URL}?${params.toString()}`;

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`binance klines error: ${res.status} ${body}`);
    }
    const batch = (await res.json()) as BinanceKline[];
    if (batch.length === 0) break;

    for (const k of batch) {
      allBars.push({
        date: new Date(k[0]),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
      });
    }

    const lastOpen = batch[batch.length - 1]![0];
    cursor = lastOpen + MS_PER_DAY;
    if (batch.length < KLINE_LIMIT) break;
  }

  return allBars;
}

/**
 * CoinGecko market_chart endpoint (close-only price series).
 *
 * GET /coins/{id}/market_chart?vs_currency=usd&days=N
 *   N <= 1   → 5-minute granularity
 *   2..90    → hourly
 *   91+      → daily 00:00 UTC (what we want)
 *
 * The OHLC endpoint cannot return true 1-day candles (it returns 4h for
 * 30/90 and 4d for 180+), so we use market_chart and synthesize OHLC by
 * setting open=high=low=close. Volume is null since this endpoint does
 * not provide it.
 *
 * Free tier: ~30 req/min. We make 1 request per asset per live run.
 */
async function fetchFromCoinGecko(
  asset: AssetSymbol,
  startIso: string,
  endIso: string,
): Promise<DailyBar[]> {
  const id = toCoingeckoId(asset);
  const startMs = toMs(startIso);
  const endMs = toMs(endIso) + MS_PER_DAY - 1;
  const daysSpan = Math.ceil((Date.now() - startMs) / MS_PER_DAY);
  // Force daily granularity: minimum 91 days. Cap at 365 (free-tier limit).
  const days = Math.min(365, Math.max(91, daysSpan));

  const url = `${COINGECKO_BASE_URL}/${id}/market_chart?vs_currency=usd&days=${days}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`coingecko market_chart error: ${res.status} ${body}`);
  }
  const raw = (await res.json()) as { prices: Array<[number, number]> };

  // Snap each point to 00:00 UTC of its date. The last point may be a
  // partial "current price" with a non-midnight timestamp; snapping makes
  // it collide with that day's daily point and get deduplicated by the
  // unique (assetId, date) constraint downstream.
  const seen = new Set<number>();
  const bars: DailyBar[] = [];
  for (const [ts, close] of raw.prices) {
    const dayMs = Math.floor(ts / MS_PER_DAY) * MS_PER_DAY;
    if (dayMs < startMs || dayMs > endMs) continue;
    if (seen.has(dayMs)) continue;
    seen.add(dayMs);
    bars.push({
      date: new Date(dayMs),
      open: close,
      high: close,
      low: close,
      close,
      volume: null,
    });
  }
  return bars;
}

export async function fetchCryptoDaily(
  asset: AssetSymbol,
  startIso: string,
  endIso: string,
): Promise<DailyBar[]> {
  try {
    return await fetchFromBinance(asset, startIso, endIso);
  } catch (e) {
    console.warn(
      `Binance kline failed (${(e as Error).message}), falling back to CoinGecko`,
    );
    return await fetchFromCoinGecko(asset, startIso, endIso);
  }
}
