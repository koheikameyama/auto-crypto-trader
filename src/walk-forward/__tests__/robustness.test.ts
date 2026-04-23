import { describe, it, expect } from "vitest";
import {
  checkRobustness,
  checkCrossAssetRobustness,
  defaultRobustness,
} from "../robustness.js";
import type { WfAggregate } from "../engine.js";
import type { AssetSymbol } from "../../types/asset.js";

function mkAgg(
  overrides: Partial<WfAggregate<Record<string, number>>> = {},
): WfAggregate<Record<string, number>> {
  return {
    windows: [],
    oosAvgSharpe: 1.2,
    oosAvgMar: 0.8,
    oosAvgPf: 1.5,
    oosMaxDd: 0.15,
    oosAvgTotalReturn: 0.15,
    isOosSharpeDrop: 0.2,
    ...overrides,
  };
}

describe("checkRobustness", () => {
  it("passes when all criteria are met", () => {
    const agg = mkAgg();
    const r = checkRobustness(agg);
    expect(r.passed).toBe(true);
    expect(r.reasons).toHaveLength(0);
  });

  it("fails when oosAvgSharpe < minSharpe", () => {
    const agg = mkAgg({ oosAvgSharpe: 0.5 });
    const r = checkRobustness(agg);
    expect(r.passed).toBe(false);
    expect(r.reasons.some((msg) => msg.toLowerCase().includes("sharpe"))).toBe(
      true,
    );
  });

  it("fails when oosAvgMar < minMar", () => {
    const agg = mkAgg({ oosAvgMar: 0.1 });
    const r = checkRobustness(agg);
    expect(r.passed).toBe(false);
    expect(r.reasons.some((m) => m.toLowerCase().includes("mar"))).toBe(true);
  });

  it("fails when oosAvgPf < minPf", () => {
    const agg = mkAgg({ oosAvgPf: 1.1 });
    const r = checkRobustness(agg);
    expect(r.passed).toBe(false);
    expect(r.reasons.some((m) => m.toLowerCase().includes("pf"))).toBe(true);
  });

  it("fails when oosMaxDd > maxDd (crypto 30% threshold)", () => {
    const agg = mkAgg({ oosMaxDd: 0.35 });
    const r = checkRobustness(agg);
    expect(r.passed).toBe(false);
    expect(r.reasons.some((m) => m.toLowerCase().includes("dd"))).toBe(true);
  });

  it("passes when oosMaxDd is within 30% crypto threshold (would fail FX 20%)", () => {
    const agg = mkAgg({ oosMaxDd: 0.25 });
    const r = checkRobustness(agg);
    expect(r.passed).toBe(true);
  });

  it("fails when isOosSharpeDrop > maxSharpeDrop", () => {
    const agg = mkAgg({ isOosSharpeDrop: 0.5 });
    const r = checkRobustness(agg);
    expect(r.passed).toBe(false);
    expect(r.reasons.some((m) => m.toLowerCase().includes("drop"))).toBe(true);
  });

  it("lists multiple reasons when multiple criteria fail", () => {
    const agg = mkAgg({
      oosAvgSharpe: 0.5,
      oosAvgPf: 1.0,
      oosMaxDd: 0.4,
    });
    const r = checkRobustness(agg);
    expect(r.passed).toBe(false);
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
  });

  it("respects custom criteria", () => {
    const agg = mkAgg({ oosAvgSharpe: 1.2 });
    const r = checkRobustness(agg, { ...defaultRobustness, minSharpe: 2.0 });
    expect(r.passed).toBe(false);
  });
});

describe("checkCrossAssetRobustness (crypto: minPassing=1 of 2)", () => {
  it("passes when 1 of 2 assets passes (default minPassingAssets=1)", () => {
    const perAsset: Partial<Record<AssetSymbol, WfAggregate<Record<string, number>>>> = {
      "BTC-USD": mkAgg(),
      "ETH-USD": mkAgg({ oosAvgSharpe: 0.3 }),
    };
    const r = checkCrossAssetRobustness(perAsset);
    expect(r.passed).toBe(true);
    expect(r.passingAssets).toEqual(["BTC-USD"]);
    expect(r.details["BTC-USD"]?.passed).toBe(true);
    expect(r.details["ETH-USD"]?.passed).toBe(false);
  });

  it("fails when 0 of 2 assets passes", () => {
    const perAsset: Partial<Record<AssetSymbol, WfAggregate<Record<string, number>>>> = {
      "BTC-USD": mkAgg({ oosAvgSharpe: 0.3 }),
      "ETH-USD": mkAgg({ oosAvgSharpe: 0.3 }),
    };
    const r = checkCrossAssetRobustness(perAsset);
    expect(r.passed).toBe(false);
    expect(r.passingAssets).toHaveLength(0);
  });

  it("passes when both assets pass", () => {
    const perAsset: Partial<Record<AssetSymbol, WfAggregate<Record<string, number>>>> = {
      "BTC-USD": mkAgg(),
      "ETH-USD": mkAgg(),
    };
    const r = checkCrossAssetRobustness(perAsset);
    expect(r.passed).toBe(true);
    expect(r.passingAssets).toHaveLength(2);
  });

  it("respects custom minPassingAssets=2 (stricter)", () => {
    const perAsset: Partial<Record<AssetSymbol, WfAggregate<Record<string, number>>>> = {
      "BTC-USD": mkAgg(),
      "ETH-USD": mkAgg({ oosAvgSharpe: 0.3 }),
    };
    const r = checkCrossAssetRobustness(perAsset, defaultRobustness, 2);
    expect(r.passed).toBe(false);
    expect(r.passingAssets).toHaveLength(1);
  });
});
