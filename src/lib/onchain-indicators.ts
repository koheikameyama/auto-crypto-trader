import type { OnchainBar } from "../data/onchain-loader.js";

export interface OnchainFeatureBar extends OnchainBar {
  /** Rolling-smoothed NVT ratio proxy = capMrktUsd / txCnt, MA'd */
  nvtProxy: number | null;
  /** Active address ratio = adrActCnt / MA(adrActCnt, aaLookback) */
  aaMomentum: number | null;
  /** Percentile of nvtProxy within trailing `percentileWindow` days (0..1) */
  nvtPercentile: number | null;
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

/**
 * Rolling percentile rank of each element within its trailing window.
 * Returns value in [0, 1] — fraction of window values that are <= current.
 * `null` during warm-up (i < window - 1).
 */
export function rollingPercentile(
  values: (number | null)[],
  window: number,
): (number | null)[] {
  if (window <= 1) throw new Error(`window must be > 1, got ${window}`);
  const n = values.length;
  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = window - 1; i < n; i++) {
    const cur = values[i];
    if (cur === null) continue;
    let count = 0;
    let total = 0;
    for (let j = i - window + 1; j <= i; j++) {
      const v = values[j];
      if (v === null) continue;
      total++;
      if (v <= cur) count++;
    }
    out[i] = total > 0 ? count / total : null;
  }
  return out;
}

export interface ComputeArgs {
  nvtLookback: number; // MA window for nvtProxy smoothing
  aaLookback: number; // MA window for active addresses
  percentileWindow: number; // rolling window for nvtProxy percentile
}

export function computeOnchainFeatures(
  bars: OnchainBar[],
  args: ComputeArgs,
): OnchainFeatureBar[] {
  const { nvtLookback, aaLookback, percentileWindow } = args;

  // Raw NVT proxy = capMrktUsd / txCnt
  const nvtRaw = bars.map((b) => (b.txCnt > 0 ? b.capMrktUsd / b.txCnt : null));
  // Smooth with MA (skip nulls = treat as missing and carry last valid)
  // Use only bars with valid raw and fill forward
  const nvtRawNumbers = nvtRaw.map((v) => (v === null ? 0 : v));
  const nvtSmoothed = simpleMa(nvtRawNumbers, nvtLookback);

  // Active address MA
  const adrArr = bars.map((b) => b.adrActCnt);
  const adrMa = simpleMa(adrArr, aaLookback);

  // Percentile of smoothed NVT over trailing window
  const nvtPct = rollingPercentile(nvtSmoothed, percentileWindow);

  const out: OnchainFeatureBar[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const nvt = nvtSmoothed[i];
    const ma = adrMa[i];
    const aaMomentum = ma !== null && ma > 0 ? b.adrActCnt / ma : null;
    out.push({
      ...b,
      nvtProxy: nvt,
      aaMomentum,
      nvtPercentile: nvtPct[i],
    });
  }
  return out;
}
