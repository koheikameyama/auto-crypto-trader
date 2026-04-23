import type { Strategy } from "../../types/strategy.js";
import {
  nr7BreakoutStrategy,
  type Nr7Params,
} from "../nr7-breakout/index.js";
import { filterEntrySignalsByTrend } from "../../lib/trend-filter.js";

const SMA_PERIOD = 50;

export const nr7BreakoutTrendFilteredStrategy: Strategy<Nr7Params> = {
  name: "nr7-breakout-tf",
  defaultParams: nr7BreakoutStrategy.defaultParams,
  exitConfig: nr7BreakoutStrategy.exitConfig,
  generateSignals(bars, asset, params) {
    const raw = nr7BreakoutStrategy.generateSignals(bars, asset, params);
    return filterEntrySignalsByTrend(bars, raw, SMA_PERIOD);
  },
};
