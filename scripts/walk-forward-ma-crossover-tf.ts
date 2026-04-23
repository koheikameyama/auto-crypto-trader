import { maCrossoverTrendFilteredStrategy } from "../src/core/wrapped/ma-crossover-tf.js";
import type { Strategy } from "../src/types/strategy.js";
import { runWfForAllAssets } from "./walk-forward-shared.js";

const paramGrid: Record<string, number[]> = {
  shortEma: [10, 20, 30],
  longEma: [50, 100, 200],
  atrPeriod: [14],
};

runWfForAllAssets({
  strategy: maCrossoverTrendFilteredStrategy as unknown as Strategy<Record<string, number>>,
  paramGrid,
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
