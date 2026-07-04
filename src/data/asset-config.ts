import type { AssetSymbol } from "../types/asset.js";

export interface AssetConfig {
  symbol: AssetSymbol;
  yfinanceTicker: string;
  feeRate: number;
}

const CONFIGS: Record<AssetSymbol, AssetConfig> = {
  "BTC-USD": {
    symbol: "BTC-USD",
    yfinanceTicker: "BTC-USD",
    feeRate: 0.001,
  },
  "ETH-USD": {
    symbol: "ETH-USD",
    yfinanceTicker: "ETH-USD",
    feeRate: 0.001,
  },
  // Round 14 cross-asset 検証用（backtest only、live 発注対象ではない）
  "SOL-USD": {
    symbol: "SOL-USD",
    yfinanceTicker: "SOL-USD",
    feeRate: 0.001,
  },
  "BNB-USD": {
    symbol: "BNB-USD",
    yfinanceTicker: "BNB-USD",
    feeRate: 0.001,
  },
};

export function getAssetConfig(asset: AssetSymbol): AssetConfig {
  return CONFIGS[asset];
}
