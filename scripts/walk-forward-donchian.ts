import { donchianStrategy } from "../src/core/donchian/index.js";
import type { Strategy } from "../src/types/strategy.js";
import { runWfForAllAssets } from "./walk-forward-shared.js";

const paramGrid: Record<string, number[]> = {
  entryPeriod: [10, 20, 30, 55],
  exitPeriod: [10, 20, 55],
  atrPeriod: [14],
};

runWfForAllAssets({
  strategy: donchianStrategy as unknown as Strategy<Record<string, number>>,
  paramGrid,
}).catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
