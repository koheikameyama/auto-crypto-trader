import type { DailyBar } from "./bar.js";
import type { EntrySignal } from "./signal.js";
import type { AssetSymbol } from "./asset.js";

export interface ExitConfig {
  useTrailing: boolean;
  timeStopDays: number;
  timeStopMaxDays: number;
  slAtrMultiplier: number;
  beAtrMultiplier: number;
  trailAtrMultiplier: number;
}

export interface Strategy<P = Record<string, unknown>> {
  name: string;
  defaultParams: P;
  exitConfig: ExitConfig;
  generateSignals(bars: DailyBar[], asset: AssetSymbol, params: P): EntrySignal[];
}
