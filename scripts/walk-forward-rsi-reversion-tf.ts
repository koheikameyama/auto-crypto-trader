import { rsiReversionTrendFilteredStrategy } from "../src/core/wrapped/rsi-reversion-tf.js";
import type { Strategy } from "../src/types/strategy.js";
import { runWfForAllAssets } from "./walk-forward-shared.js";

const paramGrid: Record<string, number[]> = {
  rsiPeriod: [7, 14, 21],
  buyThreshold: [20, 25, 30, 35],
  sellThreshold: [65, 70, 75, 80],
  atrPeriod: [14],
};

runWfForAllAssets({
  strategy: rsiReversionTrendFilteredStrategy as unknown as Strategy<Record<string, number>>,
  paramGrid,
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
