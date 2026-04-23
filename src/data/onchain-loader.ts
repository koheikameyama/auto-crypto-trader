import type { AssetSymbol } from "../types/asset.js";

export interface OnchainBar {
  date: Date;
  priceUsd: number;
  capMrktUsd: number;
  txCnt: number;
  adrActCnt: number;
}

interface ServiceBar {
  date: string;
  priceUsd: number;
  capMrktUsd: number;
  txCnt: number;
  adrActCnt: number;
}

interface ServiceResponse {
  asset: string;
  bars: ServiceBar[];
}

function getServiceUrl(): string {
  return process.env.YFINANCE_SERVICE_URL ?? "http://localhost:8766";
}

/**
 * CoinMetrics サイドカー経由で BTC (のみサポート) のオンチェーン指標を取得。
 */
export async function fetchOnchainDaily(
  asset: AssetSymbol,
  startIso: string,
  endIso: string,
): Promise<OnchainBar[]> {
  if (asset !== "BTC-USD") {
    throw new Error(
      `Onchain metrics only supported for BTC-USD (free tier), got ${asset}`,
    );
  }
  const base = getServiceUrl().replace(/\/$/, "");
  const params = new URLSearchParams({
    asset: "btc",
    start: startIso,
    end: endIso,
  });
  const url = `${base}/onchain/daily?${params.toString()}`;

  const headers: Record<string, string> = {};
  const secret = process.env.SIDECAR_SECRET;
  if (secret) headers["x-api-key"] = secret;

  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`sidecar error: ${res.status} ${body}`);
  }
  const body = (await res.json()) as ServiceResponse;
  return body.bars.map((b) => ({
    date: new Date(`${b.date}T00:00:00Z`),
    priceUsd: b.priceUsd,
    capMrktUsd: b.capMrktUsd,
    txCnt: b.txCnt,
    adrActCnt: b.adrActCnt,
  }));
}
