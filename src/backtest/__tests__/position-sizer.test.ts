import { describe, it, expect } from "vitest";
import { calcPositionUnits } from "../position-sizer.js";

describe("calcPositionUnits", () => {
  it("basic: 10000 USD × 1% / 1000 slDistance = 0.1 units", () => {
    expect(
      calcPositionUnits({
        equity: 10_000,
        riskRatio: 0.01,
        slDistance: 1_000,
      }),
    ).toBeCloseTo(0.1, 6);
  });

  it("allows fractional units (no flooring)", () => {
    // 10000 × 0.01 / 1234.56 = 0.08100051840...
    const units = calcPositionUnits({
      equity: 10_000,
      riskRatio: 0.01,
      slDistance: 1234.56,
    });
    expect(units).toBeCloseTo(100 / 1234.56, 8);
    expect(Number.isInteger(units)).toBe(false);
  });

  it("returns 0 when slDistance is 0", () => {
    expect(
      calcPositionUnits({
        equity: 10_000,
        riskRatio: 0.01,
        slDistance: 0,
      }),
    ).toBe(0);
  });

  it("returns 0 when slDistance is negative", () => {
    expect(
      calcPositionUnits({
        equity: 10_000,
        riskRatio: 0.01,
        slDistance: -100,
      }),
    ).toBe(0);
  });

  it("returns 0 when equity is 0 or negative", () => {
    expect(
      calcPositionUnits({ equity: 0, riskRatio: 0.01, slDistance: 100 }),
    ).toBe(0);
    expect(
      calcPositionUnits({ equity: -1000, riskRatio: 0.01, slDistance: 100 }),
    ).toBe(0);
  });

  it("returns 0 when riskRatio is 0 or negative", () => {
    expect(
      calcPositionUnits({ equity: 10_000, riskRatio: 0, slDistance: 100 }),
    ).toBe(0);
    expect(
      calcPositionUnits({ equity: 10_000, riskRatio: -0.01, slDistance: 100 }),
    ).toBe(0);
  });

  it("scales linearly with equity and riskRatio", () => {
    const base = calcPositionUnits({
      equity: 10_000,
      riskRatio: 0.01,
      slDistance: 1_000,
    });
    expect(
      calcPositionUnits({ equity: 20_000, riskRatio: 0.01, slDistance: 1_000 }),
    ).toBeCloseTo(base * 2, 8);
    expect(
      calcPositionUnits({ equity: 10_000, riskRatio: 0.02, slDistance: 1_000 }),
    ).toBeCloseTo(base * 2, 8);
  });

  it("inversely proportional to slDistance", () => {
    const base = calcPositionUnits({
      equity: 10_000,
      riskRatio: 0.01,
      slDistance: 1_000,
    });
    expect(
      calcPositionUnits({ equity: 10_000, riskRatio: 0.01, slDistance: 2_000 }),
    ).toBeCloseTo(base / 2, 8);
  });
});
