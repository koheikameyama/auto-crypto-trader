import { computeATR } from "../../lib/indicators/atr.js";
import { computeRSI } from "../../lib/indicators/rsi.js";
import type { Strategy } from "../../types/strategy.js";
import type { EntrySignal } from "../../types/signal.js";
import type { DailyBar } from "../../types/bar.js";
import type { AssetSymbol } from "../../types/asset.js";
import { rsiReversionDefaults, type RsiReversionParams } from "./params.js";

export { rsiReversionDefaults } from "./params.js";
export type { RsiReversionParams } from "./params.js";

export const rsiReversionStrategy: Strategy<RsiReversionParams> = {
  name: "rsi-reversion",
  defaultParams: rsiReversionDefaults,
  exitConfig: {
    useTrailing: false,
    timeStopDays: 5,
    timeStopMaxDays: 10,
    slAtrMultiplier: 1.0,
    beAtrMultiplier: 0.5,
    trailAtrMultiplier: 1.0,
  },
  generateSignals(
    bars: DailyBar[],
    asset: AssetSymbol,
    params: RsiReversionParams,
  ): EntrySignal[] {
    const closes = bars.map((b) => b.close);
    const rsi = computeRSI(closes, params.rsiPeriod);
    const atr = computeATR(bars, params.atrPeriod);
    const signals: EntrySignal[] = [];
    for (let i = 1; i < bars.length; i++) {
      const rNow = rsi[i];
      const rPrev = rsi[i - 1];
      const a = atr[i];
      if (rNow === null || rPrev === null || a === null) continue;
      if (rPrev >= params.buyThreshold && rNow < params.buyThreshold) {
        signals.push({
          date: bars[i].date,
          asset,
          side: "long",
          entryPrice: bars[i].close,
          atr: a,
        });
      } else if (rPrev <= params.sellThreshold && rNow > params.sellThreshold) {
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
