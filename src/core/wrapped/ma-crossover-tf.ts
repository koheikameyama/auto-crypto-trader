import type { Strategy } from "../../types/strategy.js";
import {
  maCrossoverStrategy,
  type MaCrossoverParams,
} from "../ma-crossover/index.js";
import { filterEntrySignalsByTrend } from "../../lib/trend-filter.js";

const SMA_PERIOD = 50;

export const maCrossoverTrendFilteredStrategy: Strategy<MaCrossoverParams> = {
  name: "ma-crossover-tf",
  defaultParams: maCrossoverStrategy.defaultParams,
  exitConfig: maCrossoverStrategy.exitConfig,
  generateSignals(bars, asset, params) {
    const raw = maCrossoverStrategy.generateSignals(bars, asset, params);
    return filterEntrySignalsByTrend(bars, raw, SMA_PERIOD);
  },
};
