import type { DailyBar } from "../../types/bar.js";

export function donchianChannel(
  bars: DailyBar[],
  period: number,
): { upper: (number | null)[]; lower: (number | null)[] } {
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < bars.length; i++) {
    if (i < period - 1) {
      upper.push(null);
      lower.push(null);
      continue;
    }
    let h = -Infinity;
    let l = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].high > h) h = bars[j].high;
      if (bars[j].low < l) l = bars[j].low;
    }
    upper.push(h);
    lower.push(l);
  }
  return { upper, lower };
}
