import type { Strategy } from "../../types/strategy.js";
import {
  rsiReversionStrategy,
  type RsiReversionParams,
} from "../rsi-reversion/index.js";
import { filterEntrySignalsByTrend } from "../../lib/trend-filter.js";

const SMA_PERIOD = 50;

export const rsiReversionTrendFilteredStrategy: Strategy<RsiReversionParams> = {
  name: "rsi-reversion-tf",
  defaultParams: rsiReversionStrategy.defaultParams,
  exitConfig: rsiReversionStrategy.exitConfig,
  generateSignals(bars, asset, params) {
    const raw = rsiReversionStrategy.generateSignals(bars, asset, params);
    return filterEntrySignalsByTrend(bars, raw, SMA_PERIOD);
  },
};
