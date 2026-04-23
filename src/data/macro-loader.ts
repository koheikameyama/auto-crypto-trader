import type { DailyBar } from "../types/bar.js";

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

/**
 * yfinance 経由でマクロ指標の日足を取得（DXY / VIX / 金など）。
 * US 営業日のみ返る（週末・祝日は bar なし）→ caller で forward-fill する想定。
 */
export async function fetchMacroDaily(
  ticker: string,
  startIso: string,
  endIso: string,
): Promise<DailyBar[]> {
  const base = getServiceUrl().replace(/\/$/, "");
  const params = new URLSearchParams({
    ticker,
    start: startIso,
    end: endIso,
  });
  const url = `${base}/macro/daily?${params.toString()}`;

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
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume,
  }));
}

/**
 * US 営業日しかない macroBars を、指定された daily dates に forward-fill で align する。
 * 各 date について、その date 以前の最新 macro bar の close を返す。
 */
export function forwardFillMacro(
  macroBars: DailyBar[],
  dates: Date[],
): (number | null)[] {
  if (macroBars.length === 0 || dates.length === 0) {
    return new Array(dates.length).fill(null);
  }
  // Sort macroBars by date ascending (defensive)
  const sorted = [...macroBars].sort(
    (a, b) => a.date.getTime() - b.date.getTime(),
  );
  const out: (number | null)[] = [];
  let idx = 0;
  for (const d of dates) {
    const t = d.getTime();
    while (idx + 1 < sorted.length && sorted[idx + 1].date.getTime() <= t) {
      idx++;
    }
    if (sorted[idx].date.getTime() > t) {
      // d is before the first macro bar → no data
      out.push(null);
    } else {
      out.push(sorted[idx].close);
    }
  }
  return out;
}
