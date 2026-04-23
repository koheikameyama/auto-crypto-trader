import { describe, it, expect } from "vitest";
import { evaluateExit, type PositionState } from "../exit-manager.js";
import type { DailyBar } from "../../types/bar.js";
import type { ExitConfig } from "../../types/strategy.js";

const cfg: ExitConfig = {
  useTrailing: true,
  timeStopDays: 10,
  timeStopMaxDays: 20,
  slAtrMultiplier: 1.0,
  beAtrMultiplier: 0.5,
  trailAtrMultiplier: 1.0,
};

function baseLong(): PositionState {
  // BTC-USD long at 50000, ATR 500, initial SL at 49500
  return {
    asset: "BTC-USD",
    side: "long",
    entryDate: new Date("2024-01-01"),
    entryPrice: 50000,
    entryAtr: 500,
    units: 0.1,
    currentSl: 49500,
    highSinceEntry: 50000,
    lowSinceEntry: 50000,
    hasBreakEven: false,
  };
}

function baseShort(): PositionState {
  return {
    asset: "BTC-USD",
    side: "short",
    entryDate: new Date("2024-01-01"),
    entryPrice: 50000,
    entryAtr: 500,
    units: 0.1,
    currentSl: 50500,
    highSinceEntry: 50000,
    lowSinceEntry: 50000,
    hasBreakEven: false,
  };
}

function bar(open: number, high: number, low: number, close: number): DailyBar {
  return { date: new Date("2024-01-02"), open, high, low, close, volume: null };
}

describe("evaluateExit — long side", () => {
  it("no exit when bar stays within bounds", () => {
    const result = evaluateExit(baseLong(), bar(50100, 50300, 49900, 50200), 1, cfg);
    expect(result.exit.exited).toBe(false);
    expect(result.newState.highSinceEntry).toBeCloseTo(50300, 5);
    expect(result.newState.lowSinceEntry).toBeCloseTo(49900, 5);
  });

  it("SL hit when bar.low <= currentSl → exit at currentSl price", () => {
    const result = evaluateExit(baseLong(), bar(49800, 50000, 49400, 49700), 1, cfg);
    expect(result.exit.exited).toBe(true);
    expect(result.exit.exitReason).toBe("sl");
    expect(result.exit.exitPrice).toBe(49500);
  });

  it("BE promotion: highSinceEntry ≥ entry + ATR×0.5 → SL raised to entry", () => {
    // 50000 + 0.5×500 = 50250 threshold
    const result = evaluateExit(baseLong(), bar(50100, 50400, 50000, 50350), 1, cfg);
    expect(result.exit.exited).toBe(false);
    expect(result.newState.hasBreakEven).toBe(true);
    expect(result.newState.currentSl).toBe(50000);
  });

  it("BE does NOT trigger if high just below threshold", () => {
    const result = evaluateExit(baseLong(), bar(50100, 50240, 50000, 50200), 1, cfg);
    expect(result.exit.exited).toBe(false);
    expect(result.newState.hasBreakEven).toBe(false);
    expect(result.newState.currentSl).toBe(49500);
  });

  it("trailing stop advances SL as high increases (after BE)", () => {
    const afterBE: PositionState = {
      ...baseLong(),
      currentSl: 50000,
      hasBreakEven: true,
      highSinceEntry: 50400,
    };
    // New high 51200, trail = 1.0 × 500 = 500 → new SL = 51200 - 500 = 50700
    const result = evaluateExit(afterBE, bar(50400, 51200, 50400, 51000), 2, cfg);
    expect(result.exit.exited).toBe(false);
    expect(result.newState.currentSl).toBeCloseTo(50700, 5);
    expect(result.newState.highSinceEntry).toBeCloseTo(51200, 5);
  });

  it("trailing stop does NOT lower SL when price retraces", () => {
    const withTrail: PositionState = {
      ...baseLong(),
      currentSl: 50700,
      hasBreakEven: true,
      highSinceEntry: 51200,
    };
    const result = evaluateExit(withTrail, bar(50900, 50900, 50500, 50800), 3, cfg);
    expect(result.newState.currentSl).toBeCloseTo(50700, 5);
    expect(result.newState.highSinceEntry).toBeCloseTo(51200, 5);
  });

  it("time stop: daysHeld ≥ timeStopDays exits at close", () => {
    const result = evaluateExit(baseLong(), bar(50100, 50200, 49950, 50150), 10, cfg);
    expect(result.exit.exited).toBe(true);
    expect(result.exit.exitReason).toBe("time");
    expect(result.exit.exitPrice).toBe(50150);
  });

  it("SL takes precedence over time stop when both would trigger on same bar", () => {
    const result = evaluateExit(baseLong(), bar(49800, 50000, 49300, 49700), 10, cfg);
    expect(result.exit.exited).toBe(true);
    expect(result.exit.exitReason).toBe("sl");
    expect(result.exit.exitPrice).toBe(49500);
  });

  it("trailing SL touch on subsequent bar triggers trailing exit reason", () => {
    const withTrail: PositionState = {
      ...baseLong(),
      currentSl: 50700,
      hasBreakEven: true,
      highSinceEntry: 51200,
    };
    const result = evaluateExit(withTrail, bar(50900, 51000, 50500, 50800), 3, cfg);
    expect(result.exit.exited).toBe(true);
    expect(result.exit.exitReason).toBe("trailing");
    expect(result.exit.exitPrice).toBe(50700);
  });
});

describe("evaluateExit — short side", () => {
  it("SL hit when bar.high >= currentSl", () => {
    const result = evaluateExit(baseShort(), bar(50200, 50600, 50000, 50300), 1, cfg);
    expect(result.exit.exited).toBe(true);
    expect(result.exit.exitReason).toBe("sl");
    expect(result.exit.exitPrice).toBe(50500);
  });

  it("BE promotion: lowSinceEntry ≤ entry - ATR×0.5 → SL lowered to entry", () => {
    // 50000 - 250 = 49750 threshold
    const result = evaluateExit(baseShort(), bar(49900, 50000, 49650, 49800), 1, cfg);
    expect(result.exit.exited).toBe(false);
    expect(result.newState.hasBreakEven).toBe(true);
    expect(result.newState.currentSl).toBe(50000);
  });

  it("trailing stop lowers SL as low decreases", () => {
    const afterBE: PositionState = {
      ...baseShort(),
      currentSl: 50000,
      hasBreakEven: true,
      lowSinceEntry: 49600,
    };
    // New low 48800, trail = 500 → new SL = 48800 + 500 = 49300
    const result = evaluateExit(afterBE, bar(49500, 49600, 48800, 49000), 2, cfg);
    expect(result.newState.currentSl).toBeCloseTo(49300, 5);
    expect(result.newState.lowSinceEntry).toBeCloseTo(48800, 5);
  });

  it("time stop triggers at close for short", () => {
    const result = evaluateExit(baseShort(), bar(49900, 50100, 49800, 49950), 10, cfg);
    expect(result.exit.exited).toBe(true);
    expect(result.exit.exitReason).toBe("time");
    expect(result.exit.exitPrice).toBe(49950);
  });
});

describe("evaluateExit — useTrailing=false", () => {
  const noTrailCfg: ExitConfig = { ...cfg, useTrailing: false };

  it("does not update SL with trailing when disabled", () => {
    const afterBE: PositionState = {
      ...baseLong(),
      currentSl: 50000,
      hasBreakEven: true,
      highSinceEntry: 50400,
    };
    const result = evaluateExit(afterBE, bar(50400, 51200, 50400, 51000), 2, noTrailCfg);
    expect(result.newState.currentSl).toBe(50000);
  });

  it("time stop still works when trailing disabled", () => {
    const result = evaluateExit(baseLong(), bar(50100, 50200, 49950, 50150), 10, noTrailCfg);
    expect(result.exit.exited).toBe(true);
    expect(result.exit.exitReason).toBe("time");
  });
});
