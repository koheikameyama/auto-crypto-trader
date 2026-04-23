import type { DailyBar } from "../types/bar.js";
import type { EntrySignal } from "../types/signal.js";

/**
 * 単純移動平均（SMA）。先頭 period-1 個は null。
 * technicalindicators に頼らず自前実装（余計な warm-up 調整を避けるため）。
 */
export function simpleMovingAverage(
  bars: DailyBar[],
  period: number,
): (number | null)[] {
  const result: (number | null)[] = new Array(bars.length).fill(null);
  if (period <= 0 || bars.length < period) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) sum += bars[i].close;
  result[period - 1] = sum / period;

  for (let i = period; i < bars.length; i++) {
    sum += bars[i].close - bars[i - period].close;
    result[i] = sum / period;
  }
  return result;
}

/**
 * 200日SMA トレンドフィルタ。
 *
 * 各シグナルについて、そのシグナル発生バーの close と SMA を比較し、
 * トレンド順方向（long: close > SMA、short: close < SMA）のみ残す。
 * SMA が warm-up 中（null）のシグナルは無条件で除外。
 *
 * エントリー側のみフィルタ。exit-manager には触れない。
 */
export function filterEntrySignalsByTrend(
  bars: DailyBar[],
  signals: EntrySignal[],
  smaPeriod: number,
): EntrySignal[] {
  const sma = simpleMovingAverage(bars, smaPeriod);
  const barByTime = new Map<number, { close: number; index: number }>();
  for (let i = 0; i < bars.length; i++) {
    barByTime.set(bars[i].date.getTime(), { close: bars[i].close, index: i });
  }

  const filtered: EntrySignal[] = [];
  for (const sig of signals) {
    const entry = barByTime.get(sig.date.getTime());
    if (!entry) continue;
    const smaAtEntry = sma[entry.index];
    if (smaAtEntry === null) continue;

    const aligned =
      sig.side === "long"
        ? entry.close > smaAtEntry
        : entry.close < smaAtEntry;
    if (aligned) filtered.push(sig);
  }
  return filtered;
}
