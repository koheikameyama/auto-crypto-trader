import type { Strategy } from "../../types/strategy.js";
import { donchianStrategy, type DonchianParams } from "../donchian/index.js";
import { filterEntrySignalsByTrend } from "../../lib/trend-filter.js";

// Note: SMA200 would require 200+ bars of warm-up, but each OOS window is 182
// bars → all signals would be dropped. Use SMA50 so the filter is active
// throughout OOS. 50 is still a reasonable "medium-term trend" proxy in daily
// crypto context. See docs/plans/2026-04-23-round-4a-trend-filter.md §5.
const SMA_PERIOD = 50;

export const donchianTrendFilteredStrategy: Strategy<DonchianParams> = {
  name: "donchian-tf",
  defaultParams: donchianStrategy.defaultParams,
  exitConfig: donchianStrategy.exitConfig,
  generateSignals(bars, asset, params) {
    const raw = donchianStrategy.generateSignals(bars, asset, params);
    return filterEntrySignalsByTrend(bars, raw, SMA_PERIOD);
  },
};
