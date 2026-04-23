import { describe, it, expect } from "vitest";
import { applyFee, calcFundingCost } from "../cost-model.js";

describe("applyFee", () => {
  it("long entry: price × (1 + feeRate)", () => {
    expect(applyFee("BTC-USD", "long", "entry", 50000)).toBeCloseTo(50050, 6);
  });

  it("long exit: price × (1 - feeRate)", () => {
    expect(applyFee("BTC-USD", "long", "exit", 50000)).toBeCloseTo(49950, 6);
  });

  it("short entry: price × (1 - feeRate)", () => {
    expect(applyFee("BTC-USD", "short", "entry", 50000)).toBeCloseTo(49950, 6);
  });

  it("short exit: price × (1 + feeRate)", () => {
    expect(applyFee("BTC-USD", "short", "exit", 50000)).toBeCloseTo(50050, 6);
  });

  it("uses ETH-USD fee rate via config", () => {
    expect(applyFee("ETH-USD", "long", "entry", 3000)).toBeCloseTo(3003, 6);
  });
});

describe("calcFundingCost", () => {
  it("returns 0 when annualRate is 0 (MVP default)", () => {
    expect(calcFundingCost("BTC-USD", "long", 0.1, 50000, 30, 0)).toBe(0);
  });

  it("returns 0 when units is 0", () => {
    expect(calcFundingCost("BTC-USD", "long", 0, 50000, 30, 0.1)).toBe(0);
  });

  it("returns 0 when holdingDays is 0", () => {
    expect(calcFundingCost("BTC-USD", "long", 0.1, 50000, 0, 0.1)).toBe(0);
  });

  it("long pays funding when rate > 0 (negative PnL contribution)", () => {
    // 0.1 BTC × 50000 USD × (10% / 365) × 10 days = ~136.99 USD cost
    const result = calcFundingCost("BTC-USD", "long", 0.1, 50000, 10, 0.1);
    expect(result).toBeLessThan(0);
    expect(result).toBeCloseTo(-((0.1 * 50000 * 0.1) / 365) * 10, 4);
  });

  it("short receives funding when rate > 0 (positive PnL contribution)", () => {
    const result = calcFundingCost("BTC-USD", "short", 0.1, 50000, 10, 0.1);
    expect(result).toBeGreaterThan(0);
    expect(result).toBeCloseTo(((0.1 * 50000 * 0.1) / 365) * 10, 4);
  });

  it("scales linearly with units and holdingDays", () => {
    const base = calcFundingCost("BTC-USD", "long", 0.1, 50000, 10, 0.1);
    expect(calcFundingCost("BTC-USD", "long", 0.2, 50000, 10, 0.1)).toBeCloseTo(base * 2, 4);
    expect(calcFundingCost("BTC-USD", "long", 0.1, 50000, 20, 0.1)).toBeCloseTo(base * 2, 4);
  });
});
