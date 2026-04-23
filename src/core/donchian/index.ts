import { computeATR } from "../../lib/indicators/atr.js";
import { donchianChannel } from "../../lib/indicators/donchian.js";
import type { Strategy } from "../../types/strategy.js";
import type { EntrySignal } from "../../types/signal.js";
import type { DailyBar } from "../../types/bar.js";
import type { AssetSymbol } from "../../types/asset.js";
import { donchianDefaults, type DonchianParams } from "./params.js";

export { donchianDefaults } from "./params.js";
export type { DonchianParams } from "./params.js";

export const donchianStrategy: Strategy<DonchianParams> = {
  name: "donchian",
  defaultParams: donchianDefaults,
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
    params: DonchianParams,
  ): EntrySignal[] {
    const { upper, lower } = donchianChannel(bars, params.entryPeriod);
    const atr = computeATR(bars, params.atrPeriod);
    const signals: EntrySignal[] = [];
    for (let i = 1; i < bars.length; i++) {
      const prevUpper = upper[i - 1];
      const prevLower = lower[i - 1];
      const a = atr[i];
      if (prevUpper === null || prevLower === null || a === null) continue;
      if (bars[i].close > prevUpper) {
        signals.push({
          date: bars[i].date,
          asset,
          side: "long",
          entryPrice: bars[i].close,
          atr: a,
        });
      } else if (bars[i].close < prevLower) {
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
