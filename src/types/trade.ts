import type { AssetSymbol } from "./asset.js";

export type ExitReason = "sl" | "trailing" | "time" | "signal" | "end_of_data";

export interface BacktestTrade {
  asset: AssetSymbol;
  strategy: string;
  side: "long" | "short";
  entryDate: Date;
  entryPrice: number;
  exitDate: Date;
  exitPrice: number;
  exitReason: ExitReason;
  sizeUnits: number;
  pnlUsd: number;
  holdingDays: number;
}
