import { describe, it, expect } from "vitest";
import {
  sharpeRatio,
  maxDrawdown,
  profitFactor,
  expectancy,
  marRatio,
  annualReturn,
  winRate,
} from "../metrics.js";

describe("sharpeRatio", () => {
  it("returns 0 for empty returns", () => {
    expect(sharpeRatio([])).toBe(0);
  });
  it("handles positive returns with variance", () => {
    const result = sharpeRatio([0.01, 0.02, -0.01, 0.015, 0.005]);
    expect(result).toBeGreaterThan(0);
  });
  it("returns 0 when std is 0 (constant returns)", () => {
    expect(sharpeRatio([0.001, 0.001, 0.001])).toBe(0);
  });
  it("default annualization factor is 365 (crypto 24/7)", () => {
    // For equivalent mean/std, √365 > √252, so default > 252-mode result
    const returns = [0.01, -0.005, 0.02, 0.003, -0.01];
    const defaultResult = sharpeRatio(returns);
    const fx252 = sharpeRatio(returns, 252);
    const ratio = defaultResult / fx252;
    expect(ratio).toBeCloseTo(Math.sqrt(365 / 252), 5);
  });
  it("respects explicit annualizationFactor", () => {
    const daily = sharpeRatio([0.01, -0.005, 0.02, 0.003, -0.01], 365);
    const weekly = sharpeRatio([0.01, -0.005, 0.02, 0.003, -0.01], 52);
    expect(Math.abs(daily)).toBeGreaterThan(Math.abs(weekly));
  });
});

describe("maxDrawdown", () => {
  it("returns 0 for monotonically increasing equity", () => {
    expect(maxDrawdown([100, 110, 120])).toBe(0);
  });
  it("returns 0 for empty or single-element curve", () => {
    expect(maxDrawdown([])).toBe(0);
    expect(maxDrawdown([100])).toBe(0);
  });
  it("returns correct DD for U-shape", () => {
    expect(maxDrawdown([100, 80, 120])).toBeCloseTo(0.2, 5);
  });
  it("returns correct DD when trough follows peak", () => {
    expect(maxDrawdown([100, 150, 90, 120])).toBeCloseTo(0.4, 5);
  });
});

describe("profitFactor", () => {
  it("returns 0 for empty pnls", () => {
    expect(profitFactor([])).toBe(0);
  });
  it("returns Infinity when no losses and has wins", () => {
    expect(profitFactor([10, 20, 30])).toBe(Infinity);
  });
  it("returns 0 when no wins and no losses (all zero)", () => {
    expect(profitFactor([0, 0, 0])).toBe(0);
  });
  it("returns gross_win / gross_loss", () => {
    expect(profitFactor([10, -5, 20, -10])).toBeCloseTo(30 / 15, 5);
  });
});

describe("expectancy", () => {
  it("returns 0 for empty pnls", () => {
    expect(expectancy([])).toBe(0);
  });
  it("returns average PnL per trade", () => {
    expect(expectancy([10, -5, 20, -10])).toBeCloseTo(15 / 4, 5);
  });
});

describe("marRatio", () => {
  it("returns annual_return / max_dd", () => {
    expect(marRatio(0.15, 0.1)).toBeCloseTo(1.5, 5);
  });
  it("returns 0 when dd is 0", () => {
    expect(marRatio(0.15, 0)).toBe(0);
  });
  it("returns 0 when dd is negative (defensive)", () => {
    expect(marRatio(0.15, -0.1)).toBe(0);
  });
});

describe("annualReturn", () => {
  it("returns 0 when years <= 0", () => {
    expect(annualReturn(0.5, 0)).toBe(0);
    expect(annualReturn(0.5, -1)).toBe(0);
  });
  it("computes CAGR correctly", () => {
    expect(annualReturn(1.0, 2)).toBeCloseTo(Math.sqrt(2) - 1, 5);
  });
  it("returns total return when years == 1", () => {
    expect(annualReturn(0.2, 1)).toBeCloseTo(0.2, 5);
  });
});

describe("winRate", () => {
  it("returns 0 for empty pnls", () => {
    expect(winRate([])).toBe(0);
  });
  it("returns 0.5 for evenly split wins/losses", () => {
    expect(winRate([1, -1, 2, -2])).toBe(0.5);
  });
  it("treats exactly-zero PnL as not a win", () => {
    expect(winRate([0, 0, 1])).toBeCloseTo(1 / 3, 5);
  });
  it("returns 1 when all wins", () => {
    expect(winRate([1, 2, 3])).toBe(1);
  });
});
