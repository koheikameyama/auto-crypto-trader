import type { AssetSymbol } from "./asset.js";

export interface EntrySignal {
  date: Date;
  asset: AssetSymbol;
  side: "long" | "short";
  entryPrice: number;
  atr: number;
}
