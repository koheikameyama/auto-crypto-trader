import type { DailyBar } from "../types/bar.js";
import { alignAndComputeSpread, computeRollingZScore, type SpreadBar } from "../lib/spread.js";
import { applyFee } from "./cost-model.js";
import {
  sharpeRatio,
  maxDrawdown,
  profitFactor,
  expectancy,
  marRatio,
  annualReturn,
  winRate,
} from "../lib/metrics.js";
import type { EquityPoint } from "./engine.js";

export interface PairTradeParams extends Record<string, number> {
  lookback: number;
  entryThreshold: number;
  exitThreshold: number;
  stopThreshold: number;
  timeStopDays: number;
}

export const pairTradeDefaults: PairTradeParams = {
  lookback: 30,
  entryThreshold: 2.0,
  exitThreshold: 0.5,
  stopThreshold: 3.5,
  timeStopDays: 30,
};

export type SpreadDirection = "long-spread" | "short-spread";
export type PairExitReason =
  | "mean_revert"
  | "stop_z"
  | "time"
  | "end_of_data";

export interface PairTrade {
  direction: SpreadDirection;
  entryDate: Date;
  entryBtcPrice: number;
  entryEthPrice: number;
  entryZ: number;
  exitDate: Date;
  exitBtcPrice: number;
  exitEthPrice: number;
  exitZ: number;
  exitReason: PairExitReason;
  btcUnits: number;
  ethUnits: number;
  btcPnlUsd: number;
  ethPnlUsd: number;
  pnlUsd: number;
  holdingDays: number;
}

export interface PairBacktestResult {
  trades: PairTrade[];
  equityCurve: EquityPoint[];
  totalReturn: number;
  sharpe: number;
  mar: number;
  profitFactor: number;
  maxDrawdown: number;
  winRate: number;
  expectancy: number;
  tradeCount: number;
}

export interface PairBacktestInput {
  btcBars: DailyBar[];
  ethBars: DailyBar[];
  params: PairTradeParams;
  initialCapital: number;
  /** capital のうちこの割合を pair-trade の両レッグ合計として使う (1.0 = 全額) */
  capitalUsage?: number;
  annualFundingRate?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

interface OpenPairPosition {
  direction: SpreadDirection;
  entryDate: Date;
  entryBtcPrice: number; // effective (with fee)
  entryEthPrice: number;
  entryZ: number;
  btcUnits: number;
  ethUnits: number;
}

function empty(): PairBacktestResult {
  return {
    trades: [],
    equityCurve: [],
    totalReturn: 0,
    sharpe: 0,
    mar: 0,
    profitFactor: 0,
    maxDrawdown: 0,
    winRate: 0,
    expectancy: 0,
    tradeCount: 0,
  };
}

/**
 * Realize a pair position by closing both legs at given raw exit prices.
 * Returns per-leg PnL in USD (fees applied at exit).
 */
function closePair(
  pos: OpenPairPosition,
  rawBtcExit: number,
  rawEthExit: number,
): { btcPnl: number; ethPnl: number } {
  // For long-spread: long BTC (paid entry fee in "long entry" side, sells at exit)
  //                  short ETH (received entry short price, buys back at exit)
  // For short-spread: short BTC, long ETH
  const btcLong = pos.direction === "long-spread";
  const ethLong = !btcLong;

  const btcExit = applyFee(
    "BTC-USD",
    btcLong ? "long" : "short",
    "exit",
    rawBtcExit,
  );
  const ethExit = applyFee(
    "ETH-USD",
    ethLong ? "long" : "short",
    "exit",
    rawEthExit,
  );

  const btcPnl = btcLong
    ? (btcExit - pos.entryBtcPrice) * pos.btcUnits
    : (pos.entryBtcPrice - btcExit) * pos.btcUnits;
  const ethPnl = ethLong
    ? (ethExit - pos.entryEthPrice) * pos.ethUnits
    : (pos.entryEthPrice - ethExit) * pos.ethUnits;

  return { btcPnl, ethPnl };
}

export function runPairBacktest(input: PairBacktestInput): PairBacktestResult {
  const {
    btcBars,
    ethBars,
    params,
    initialCapital,
    capitalUsage = 1.0,
  } = input;

  const spreads = alignAndComputeSpread(btcBars, ethBars);
  if (spreads.length === 0) return empty();
  computeRollingZScore(spreads, params.lookback);

  let cash = initialCapital;
  let position: OpenPairPosition | null = null;
  const trades: PairTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  const legNotional = (initialCapital * capitalUsage) / 2;

  for (let i = 0; i < spreads.length; i++) {
    const cur = spreads[i];
    const z = cur.zScore;

    // 1. Evaluate exit if position open
    if (position !== null) {
      const daysHeld = daysBetween(position.entryDate, cur.date);
      let exitReason: PairExitReason | null = null;

      if (z !== null) {
        if (Math.abs(z) < params.exitThreshold) exitReason = "mean_revert";
        else if (Math.abs(z) > params.stopThreshold) exitReason = "stop_z";
      }
      if (!exitReason && daysHeld >= params.timeStopDays) exitReason = "time";

      if (exitReason) {
        const { btcPnl, ethPnl } = closePair(
          position,
          cur.btcClose,
          cur.ethClose,
        );
        const total = btcPnl + ethPnl;
        trades.push({
          direction: position.direction,
          entryDate: position.entryDate,
          entryBtcPrice: position.entryBtcPrice,
          entryEthPrice: position.entryEthPrice,
          entryZ: position.entryZ,
          exitDate: cur.date,
          exitBtcPrice: cur.btcClose,
          exitEthPrice: cur.ethClose,
          exitZ: z ?? 0,
          exitReason,
          btcUnits: position.btcUnits,
          ethUnits: position.ethUnits,
          btcPnlUsd: btcPnl,
          ethPnlUsd: ethPnl,
          pnlUsd: total,
          holdingDays: daysHeld,
        });
        cash += total;
        position = null;
      }
    }

    // 2. Evaluate entry if no position
    if (position === null && z !== null) {
      let direction: SpreadDirection | null = null;
      if (z > params.entryThreshold) direction = "short-spread";
      else if (z < -params.entryThreshold) direction = "long-spread";

      if (direction) {
        const btcLong = direction === "long-spread";
        const ethLong = !btcLong;
        const effBtc = applyFee(
          "BTC-USD",
          btcLong ? "long" : "short",
          "entry",
          cur.btcClose,
        );
        const effEth = applyFee(
          "ETH-USD",
          ethLong ? "long" : "short",
          "entry",
          cur.ethClose,
        );
        const btcUnits = legNotional / effBtc;
        const ethUnits = legNotional / effEth;
        position = {
          direction,
          entryDate: cur.date,
          entryBtcPrice: effBtc,
          entryEthPrice: effEth,
          entryZ: z,
          btcUnits,
          ethUnits,
        };
      }
    }

    // 3. Mark-to-market equity
    let unrealized = 0;
    if (position !== null) {
      const { btcPnl, ethPnl } = closePair(position, cur.btcClose, cur.ethClose);
      unrealized = btcPnl + ethPnl;
    }
    equityCurve.push({ date: cur.date, equity: cash + unrealized });
  }

  // Force-close at end
  if (position !== null) {
    const last = spreads[spreads.length - 1];
    const daysHeld = daysBetween(position.entryDate, last.date);
    const { btcPnl, ethPnl } = closePair(
      position,
      last.btcClose,
      last.ethClose,
    );
    const total = btcPnl + ethPnl;
    trades.push({
      direction: position.direction,
      entryDate: position.entryDate,
      entryBtcPrice: position.entryBtcPrice,
      entryEthPrice: position.entryEthPrice,
      entryZ: position.entryZ,
      exitDate: last.date,
      exitBtcPrice: last.btcClose,
      exitEthPrice: last.ethClose,
      exitZ: last.zScore ?? 0,
      exitReason: "end_of_data",
      btcUnits: position.btcUnits,
      ethUnits: position.ethUnits,
      btcPnlUsd: btcPnl,
      ethPnlUsd: ethPnl,
      pnlUsd: total,
      holdingDays: daysHeld,
    });
    cash += total;
    position = null;
    if (equityCurve.length > 0) {
      equityCurve[equityCurve.length - 1] = {
        date: last.date,
        equity: cash,
      };
    }
  }

  // KPIs
  const finalEquity =
    equityCurve.length > 0
      ? equityCurve[equityCurve.length - 1].equity
      : initialCapital;
  const totalReturn = (finalEquity - initialCapital) / initialCapital;

  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev !== 0) returns.push((equityCurve[i].equity - prev) / prev);
  }
  const sharpe = sharpeRatio(returns);
  const mdd = maxDrawdown(equityCurve.map((p) => p.equity));

  const first = equityCurve[0]?.date ?? spreads[0].date;
  const lastDate =
    equityCurve[equityCurve.length - 1]?.date ?? spreads[spreads.length - 1].date;
  const years = (lastDate.getTime() - first.getTime()) / (365.25 * DAY_MS);
  const mar = marRatio(annualReturn(totalReturn, years), mdd);

  const pnls = trades.map((t) => t.pnlUsd);
  return {
    trades,
    equityCurve,
    totalReturn,
    sharpe,
    mar,
    profitFactor: profitFactor(pnls),
    maxDrawdown: mdd,
    winRate: winRate(pnls),
    expectancy: expectancy(pnls),
    tradeCount: trades.length,
  };
}
