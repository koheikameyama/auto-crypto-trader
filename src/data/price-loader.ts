import type { DailyBar } from "../types/bar.js";
import type { AssetSymbol } from "../types/asset.js";

/**
 * Daily OHLC for BTC/ETH via Binance public klines API.
 * Previous implementation used yfinance (via Python sidecar) but
 * Yahoo blocks some cloud IPs with HTTP 451. Binance public API is
 * no-auth, reliable, and consistent with our funding rate source.
 *
 * Symbol mapping:
 *   BTC-USD → BTCUSDT
 *   ETH-USD → ETHUSDT
 *
 * USDT-denominated quotes are within a few bps of USD for all practical
 * purposes; Scheme E signals are insensitive to that margin.
 *
 * Endpoint: https://api.binance.com/api/v3/klines
 * Docs:     https://developers.binance.com/docs/binance-spot-api-docs/rest-api/market-data
 */

const BINANCE_KLINE_URL = "https://api.binance.com/api/v3/klines";
const KLINE_LIMIT = 1000;

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

function toMs(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`);
}

export async function fetchCryptoDaily(
  asset: AssetSymbol,
  startIso: string,
  endIso: string,
): Promise<DailyBar[]> {
  const symbol = toBinanceSymbol(asset);
  const startMs = toMs(startIso);
  // Binance endTime is inclusive on the open time of the candle.
  // We want bars up to and including `endIso`, so add 1 day worth of ms minus 1.
  const endMs = toMs(endIso) + 24 * 60 * 60 * 1000 - 1;

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

    // Paginate: next start = last openTime + 1 day
    const lastOpen = batch[batch.length - 1]![0];
    cursor = lastOpen + 24 * 60 * 60 * 1000;

    // Safety: if batch < limit we received all available
    if (batch.length < KLINE_LIMIT) break;
  }

  return allBars;
}
