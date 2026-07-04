import { describe, it, expect } from "vitest";
import {
  parseExecutionAssets,
  getAllocationWeight,
} from "../allocator.js";

describe("parseExecutionAssets", () => {
  it("defaults to [BTC] when unset or empty", () => {
    expect(parseExecutionAssets(undefined)).toEqual(["BTC"]);
    expect(parseExecutionAssets("")).toEqual(["BTC"]);
    expect(parseExecutionAssets("   ")).toEqual(["BTC"]);
  });

  it("parses comma-separated list, whitespace-tolerant", () => {
    expect(parseExecutionAssets("BTC,ETH")).toEqual(["BTC", "ETH"]);
    expect(parseExecutionAssets(" BTC , ETH ")).toEqual(["BTC", "ETH"]);
  });

  it("dedupes while preserving order", () => {
    expect(parseExecutionAssets("BTC,ETH,BTC")).toEqual(["BTC", "ETH"]);
  });

  it("throws on unknown symbol (typo can't silently drop an asset)", () => {
    expect(() => parseExecutionAssets("BTC,SOL")).toThrow(/Invalid/);
    expect(() => parseExecutionAssets("XRP")).toThrow(/Invalid/);
  });
});

describe("getAllocationWeight", () => {
  it("gives 1.0 for single-asset (legacy behavior)", () => {
    expect(getAllocationWeight("BTC", ["BTC"])).toBe(1);
  });

  it("gives 0.5 each for BTC,ETH (equal weight)", () => {
    expect(getAllocationWeight("BTC", ["BTC", "ETH"])).toBe(0.5);
    expect(getAllocationWeight("ETH", ["BTC", "ETH"])).toBe(0.5);
  });

  it("throws when asset is not in the execution set", () => {
    expect(() => getAllocationWeight("ETH", ["BTC"])).toThrow(/not in/);
  });

  it("throws on empty execution set", () => {
    expect(() => getAllocationWeight("BTC", [])).toThrow(/must not be empty/);
  });
});
