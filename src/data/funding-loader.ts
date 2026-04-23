export interface FundingBar {
  date: Date;
  avgRate: number; // daily average funding rate (per 8h interval, 3 per day)
  count: number; // number of funding events aggregated (normally 3)
}

interface ServiceBar {
  date: string;
  avgRate: number;
  count: number;
}

interface ServiceResponse {
  symbol: string;
  bars: ServiceBar[];
}

function getServiceUrl(): string {
  return process.env.YFINANCE_SERVICE_URL ?? "http://localhost:8766";
}

export async function fetchFundingDaily(
  symbol: string,
  startIso: string,
  endIso: string,
): Promise<FundingBar[]> {
  const base = getServiceUrl().replace(/\/$/, "");
  const params = new URLSearchParams({
    symbol,
    start: startIso,
    end: endIso,
  });
  const url = `${base}/funding/daily?${params.toString()}`;

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
    avgRate: b.avgRate,
    count: b.count,
  }));
}
