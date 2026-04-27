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
const COINGECKO_OHLC_URL = "https://api.coingecko.com/api/v3/coins";
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
 * CoinGecko OHLC endpoint.
 * Free tier: ~30 req/min. We make 1 request per day per asset, well below.
 *
 * GET /coins/{id}/ohlc?vs_currency=usd&days=N
 *   N: 1 / 7 / 14 / 30 / 90 / 180 / 365 / max
 *   30+ days returns daily granularity (1 candle per day)
 *   Returns [[ts_ms, open, high, low, close], ...] (no volume)
 */
async function fetchFromCoinGecko(
  asset: AssetSymbol,
  startIso: string,
  endIso: string,
): Promise<DailyBar[]> {
  const id = toCoingeckoId(asset);
  // Choose smallest valid `days` window covering our request
  const startMs = toMs(startIso);
  const endMs = toMs(endIso) + MS_PER_DAY - 1;
  const daysSpan = Math.ceil((Date.now() - startMs) / MS_PER_DAY);
  const validDays = [1, 7, 14, 30, 90, 180, 365, 730];
  const days = validDays.find((d) => d >= daysSpan) ?? 365;

  const url = `${COINGECKO_OHLC_URL}/${id}/ohlc?vs_currency=usd&days=${days}`;
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`coingecko ohlc error: ${res.status} ${body}`);
  }
  const raw = (await res.json()) as Array<
    [number, number, number, number, number]
  >;
  return raw
    .filter(([ts]) => ts >= startMs && ts <= endMs)
    .map(([ts, open, high, low, close]) => ({
      date: new Date(ts),
      open,
      high,
      low,
      close,
      volume: null,
    }));
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
