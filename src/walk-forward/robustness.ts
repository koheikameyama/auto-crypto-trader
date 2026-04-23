import type { AssetSymbol } from "../types/asset.js";
import type { WfAggregate } from "./engine.js";

export interface RobustnessCriteria {
  minSharpe: number;
  minMar: number;
  minPf: number;
  maxDd: number;
  maxSharpeDrop: number;
}

/**
 * Crypto MVP robustness thresholds (from design doc §2).
 * DD は 30% に緩和（高ボラ考慮）、他は FX と同じ。
 */
export const defaultRobustness: RobustnessCriteria = {
  minSharpe: 1.0,
  minMar: 0.5,
  minPf: 1.3,
  maxDd: 0.3,
  maxSharpeDrop: 0.3,
};

export interface RobustnessCheck {
  passed: boolean;
  reasons: string[];
}

export function checkRobustness<P>(
  agg: WfAggregate<P>,
  criteria: RobustnessCriteria = defaultRobustness,
): RobustnessCheck {
  const reasons: string[] = [];

  if (agg.oosAvgSharpe < criteria.minSharpe) {
    reasons.push(
      `OOS Sharpe ${agg.oosAvgSharpe.toFixed(3)} < min ${criteria.minSharpe}`,
    );
  }
  if (agg.oosAvgMar < criteria.minMar) {
    reasons.push(
      `OOS MAR ${agg.oosAvgMar.toFixed(3)} < min ${criteria.minMar}`,
    );
  }
  if (agg.oosAvgPf < criteria.minPf) {
    reasons.push(`OOS PF ${agg.oosAvgPf.toFixed(3)} < min ${criteria.minPf}`);
  }
  if (agg.oosMaxDd > criteria.maxDd) {
    reasons.push(
      `OOS Max DD ${(agg.oosMaxDd * 100).toFixed(2)}% > max ${(criteria.maxDd * 100).toFixed(2)}%`,
    );
  }
  if (agg.isOosSharpeDrop > criteria.maxSharpeDrop) {
    reasons.push(
      `IS->OOS Sharpe drop ${(agg.isOosSharpeDrop * 100).toFixed(2)}% > max ${(criteria.maxSharpeDrop * 100).toFixed(2)}%`,
    );
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

/**
 * 2銘柄中 minPassingAssets 以上の銘柄で robustness をクリアするか判定。
 * デフォルトは 1（設計 §2 の「2銘柄中1銘柄以上で主KPI達成」）。
 */
export function checkCrossAssetRobustness<P>(
  perAsset: Partial<Record<AssetSymbol, WfAggregate<P>>>,
  criteria: RobustnessCriteria = defaultRobustness,
  minPassingAssets = 1,
): {
  passed: boolean;
  passingAssets: AssetSymbol[];
  details: Partial<Record<AssetSymbol, RobustnessCheck>>;
} {
  const details: Partial<Record<AssetSymbol, RobustnessCheck>> = {};
  const passingAssets: AssetSymbol[] = [];
  const assets = Object.keys(perAsset) as AssetSymbol[];

  for (const asset of assets) {
    const agg = perAsset[asset];
    if (!agg) continue;
    const check = checkRobustness(agg, criteria);
    details[asset] = check;
    if (check.passed) {
      passingAssets.push(asset);
    }
  }

  return {
    passed: passingAssets.length >= minPassingAssets,
    passingAssets,
    details,
  };
}
