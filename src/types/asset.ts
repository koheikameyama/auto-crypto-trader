export type AssetSymbol = "BTC-USD" | "ETH-USD" | "SOL-USD" | "BNB-USD";

// Live 実行系 (src/live/) はこの配列を import しない。backtest/backfill
// scripts のみが loop に使う。SOL/BNB は Round 14 cross-asset 検証用で、
// live 発注対象ではない（EXECUTION_ASSETS には絶対に含めないこと）。
export const ASSETS: AssetSymbol[] = ["BTC-USD", "ETH-USD", "SOL-USD", "BNB-USD"];
