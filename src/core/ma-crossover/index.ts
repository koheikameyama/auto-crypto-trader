import { computeATR } from "../../lib/indicators/atr.js";
import { computeEMA } from "../../lib/indicators/ema.js";
import type { Strategy } from "../../types/strategy.js";
import type { EntrySignal } from "../../types/signal.js";
import type { DailyBar } from "../../types/bar.js";
import type { AssetSymbol } from "../../types/asset.js";
import { maCrossoverDefaults, type MaCrossoverParams } from "./params.js";

export { maCrossoverDefaults } from "./params.js";
export type { MaCrossoverParams } from "./params.js";

export const maCrossoverStrategy: Strategy<MaCrossoverParams> = {
  name: "ma-crossover",
  defaultParams: maCrossoverDefaults,
  exitConfig: {
    useTrailing: true,
    timeStopDays: 10,
    timeStopMaxDays: 20,
    slAtrMultiplier: 1.0,
    beAtrMultiplier: 0.5,
    trailAtrMultiplier: 1.0,
  },
  generateSignals(
    bars: DailyBar[],
    asset: AssetSymbol,
    params: MaCrossoverParams,
  ): EntrySignal[] {
    const closes = bars.map((b) => b.close);
    const shortE = computeEMA(closes, params.shortEma);
    const longE = computeEMA(closes, params.longEma);
    const atr = computeATR(bars, params.atrPeriod);
    const signals: EntrySignal[] = [];
    for (let i = 1; i < bars.length; i++) {
      const sNow = shortE[i];
      const lNow = longE[i];
      const sPrev = shortE[i - 1];
      const lPrev = longE[i - 1];
      const a = atr[i];
      if (
        sNow === null ||
        lNow === null ||
        sPrev === null ||
        lPrev === null ||
        a === null
      )
        continue;
      if (sPrev <= lPrev && sNow > lNow) {
        signals.push({
          date: bars[i].date,
          asset,
          side: "long",
          entryPrice: bars[i].close,
          atr: a,
        });
      } else if (sPrev >= lPrev && sNow < lNow) {
        signals.push({
          date: bars[i].date,
          asset,
          side: "short",
          entryPrice: bars[i].close,
          atr: a,
        });
      }
    }
    return signals;
  },
};
