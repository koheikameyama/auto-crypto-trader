import type { AssetSymbol } from "../types/asset.js";
import { getAssetConfig } from "../data/asset-config.js";

export type FeeType = "entry" | "exit";

/**
 * 手数料を raw price に反映する（常に不利側に動かす）。
 *
 * - long entry:  price × (1 + feeRate) — 高く買う
 * - long exit:   price × (1 - feeRate) — 安く売る
 * - short entry: price × (1 - feeRate) — 安く売る
 * - short exit:  price × (1 + feeRate) — 高く買い戻す
 */
export function applyFee(
  asset: AssetSymbol,
  side: "long" | "short",
  type: FeeType,
  rawPrice: number,
): number {
  const { feeRate } = getAssetConfig(asset);
  const isUnfavorableUp =
    (side === "long" && type === "entry") ||
    (side === "short" && type === "exit");
  return isUnfavorableUp ? rawPrice * (1 + feeRate) : rawPrice * (1 - feeRate);
}

/**
 * 永久先物の資金調達コストを計算する（PnL 寄与額を USD で返す）。
 *
 * 符号規約: 戻り値をそのまま PnL に加算すれば OK。
 *   - annualFundingRate > 0 (ロング払い・ショート受取) のとき
 *     - long  → 負の寄与 (loss)
 *     - short → 正の寄与 (gain)
 *
 * notional は `units × entryPrice` の初期ノーショナルで近似（MVP）。
 * MVP 本体では `annualFundingRate = 0` を渡すので戻り値は常に 0。
 * 感度分析用途でのみ値を渡す。
 */
export function calcFundingCost(
  _asset: AssetSymbol,
  side: "long" | "short",
  units: number,
  entryPrice: number,
  holdingDays: number,
  annualFundingRate: number,
): number {
  if (units === 0 || holdingDays === 0 || annualFundingRate === 0) return 0;
  const dailyRate = annualFundingRate / 365;
  const notional = units * entryPrice;
  const magnitude = dailyRate * notional * holdingDays;
  return side === "long" ? -magnitude : magnitude;
}
