import type { ActualAsset } from "./execution-adapter.js";

/**
 * Multi-asset capital allocation for actual GMO execution.
 *
 * GMO spot has a SINGLE shared JPY balance — there are no sub-accounts. When
 * more than one asset is executed (e.g. BTC + ETH), each per-asset rebalance
 * must operate within its own budget slice of the total account equity,
 * otherwise every asset claims the full JPY pool and the combined crypto
 * exposure over-shoots (forbidden #6).
 *
 * Policy (Round 15, KOH-480): equal weight = 1 / N.
 *   - EXECUTION_ASSETS=BTC        → weight(BTC) = 1.0  (identical to legacy behavior)
 *   - EXECUTION_ASSETS=BTC,ETH    → weight(BTC) = weight(ETH) = 0.5
 *
 * Equal weight matches the backtest's equal-weight BH benchmark and introduces
 * no in-sample-fit parameters. Signal-strength / risk-parity weighting is
 * intentionally out of scope until separately validated.
 */

const VALID_ASSETS: readonly ActualAsset[] = ["BTC", "ETH"];

/**
 * Parse the EXECUTION_ASSETS env var into a validated asset list.
 * Defaults to ["BTC"] when unset/empty. Order-insensitive, whitespace-tolerant.
 * Throws on unknown symbols so a typo can't silently drop an asset.
 */
export function parseExecutionAssets(
  raw: string | undefined,
): ActualAsset[] {
  const parts = (raw ?? "BTC")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const list = parts.length > 0 ? parts : ["BTC"];

  const seen = new Set<string>();
  const result: ActualAsset[] = [];
  for (const p of list) {
    if (!VALID_ASSETS.includes(p as ActualAsset)) {
      throw new Error(
        `Invalid EXECUTION_ASSETS entry "${p}" (allowed: ${VALID_ASSETS.join(", ")})`,
      );
    }
    if (!seen.has(p)) {
      seen.add(p);
      result.push(p as ActualAsset);
    }
  }
  return result;
}

/**
 * Equal-weight allocation: each asset in the execution set gets 1 / N of the
 * total account equity. `asset` must be a member of `executionAssets`.
 */
export function getAllocationWeight(
  asset: ActualAsset,
  executionAssets: ActualAsset[],
): number {
  if (executionAssets.length === 0) {
    throw new Error("executionAssets must not be empty");
  }
  if (!executionAssets.includes(asset)) {
    throw new Error(
      `asset ${asset} not in EXECUTION_ASSETS [${executionAssets.join(", ")}]`,
    );
  }
  return 1 / executionAssets.length;
}
