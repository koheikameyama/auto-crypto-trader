import type { DailyBar } from "../types/bar.js";
import type { AssetSymbol } from "../types/asset.js";
import { getAssetConfig } from "./asset-config.js";

interface ServiceBar {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

interface ServiceResponse {
  ticker: string;
  bars: ServiceBar[];
}

function getServiceUrl(): string {
  return process.env.YFINANCE_SERVICE_URL ?? "http://localhost:8766";
}

export async function fetchCryptoDaily(
  asset: AssetSymbol,
  startIso: string,
  endIso: string,
): Promise<DailyBar[]> {
  const { yfinanceTicker } = getAssetConfig(asset);
  const base = getServiceUrl().replace(/\/$/, "");
  const params = new URLSearchParams({
    ticker: yfinanceTicker,
    start: startIso,
    end: endIso,
  });
  const url = `${base}/crypto/daily?${params.toString()}`;

  const headers: Record<string, string> = {};
  const secret = process.env.SIDECAR_SECRET;
  if (secret) {
    headers["x-api-key"] = secret;
  }

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`yfinance-service error: ${res.status} ${body}`);
  }

  const body = (await res.json()) as ServiceResponse;
  return body.bars.map((b) => ({
    date: new Date(`${b.date}T00:00:00Z`),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}
