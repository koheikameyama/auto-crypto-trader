import { nr7BreakoutStrategy } from "../src/core/nr7-breakout/index.js";
import type { Strategy } from "../src/types/strategy.js";
import { runWfForAllAssets } from "./walk-forward-shared.js";

const paramGrid: Record<string, number[]> = {
  lookback: [5, 7, 10],
  atrPeriod: [14],
};

runWfForAllAssets({
  strategy: nr7BreakoutStrategy as unknown as Strategy<Record<string, number>>,
  paramGrid,
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
