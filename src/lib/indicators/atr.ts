import { ATR } from "technicalindicators";
import type { DailyBar } from "../../types/bar.js";

export function computeATR(bars: DailyBar[], period = 14): (number | null)[] {
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const close = bars.map((b) => b.close);
  const values = ATR.calculate({ period, high, low, close });
  const pad = bars.length - values.length;
  const result: (number | null)[] = new Array(pad).fill(null);
  for (const v of values) result.push(v);
  return result;
}
