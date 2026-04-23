import type { DailyBar } from "../types/bar.js";

export interface SpreadBar {
  date: Date;
  btcClose: number;
  ethClose: number;
  /** log(BTC) - log(ETH) */
  spread: number;
  /** rolling z-score (null during warm-up or when std=0) */
  zScore: number | null;
  /** rolling mean (null during warm-up) */
  mean: number | null;
  /** rolling std (null during warm-up) */
  std: number | null;
}

/**
 * BTC と ETH の DailyBar を date マッチで結合し、log ratio spread を計算する。
 * 片方にしかない日は捨てる。結果は両方の bars がある最初の日から最後の日まで。
 */
export function alignAndComputeSpread(
  btcBars: DailyBar[],
  ethBars: DailyBar[],
): SpreadBar[] {
  const ethByTime = new Map<number, DailyBar>();
  for (const b of ethBars) ethByTime.set(b.date.getTime(), b);

  const result: SpreadBar[] = [];
  for (const btc of btcBars) {
    const eth = ethByTime.get(btc.date.getTime());
    if (!eth) continue;
    if (btc.close <= 0 || eth.close <= 0) continue;
    result.push({
      date: btc.date,
      btcClose: btc.close,
      ethClose: eth.close,
      spread: Math.log(btc.close) - Math.log(eth.close),
      zScore: null,
      mean: null,
      std: null,
    });
  }
  return result;
}

/**
 * Rolling window 平均・標準偏差・z-score を spread 系列に対して計算する（in-place 更新）。
 *
 * - 先頭 (lookback-1) 個は null のまま
 * - std = 0 の場合 zScore は null
 * - 各 i 点では bars[i-lookback+1 .. i] を使う（過去窓、i 含む）
 */
export function computeRollingZScore(
  spreadBars: SpreadBar[],
  lookback: number,
): void {
  if (lookback <= 1) throw new Error(`lookback must be > 1, got ${lookback}`);
  const n = spreadBars.length;
  if (n < lookback) return;

  for (let i = lookback - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - lookback + 1; j <= i; j++) sum += spreadBars[j].spread;
    const mean = sum / lookback;

    let sqSum = 0;
    for (let j = i - lookback + 1; j <= i; j++) {
      const d = spreadBars[j].spread - mean;
      sqSum += d * d;
    }
    const std = Math.sqrt(sqSum / lookback);

    spreadBars[i].mean = mean;
    spreadBars[i].std = std;
    spreadBars[i].zScore = std > 0 ? (spreadBars[i].spread - mean) / std : null;
  }
}
