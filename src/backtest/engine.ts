import type { DailyBar } from "../types/bar.js";
import type { AssetSymbol } from "../types/asset.js";
import type { EntrySignal } from "../types/signal.js";
import type { Strategy } from "../types/strategy.js";
import type { BacktestTrade, ExitReason } from "../types/trade.js";
import { calcPositionUnits } from "./position-sizer.js";
import { applyFee, calcFundingCost } from "./cost-model.js";
import { evaluateExit, type PositionState } from "./exit-manager.js";
import {
  sharpeRatio,
  maxDrawdown,
  profitFactor,
  expectancy,
  marRatio,
  annualReturn,
  winRate,
} from "../lib/metrics.js";

export interface BacktestInput<P> {
  bars: DailyBar[];
  asset: AssetSymbol;
  strategy: Strategy<P>;
  params: P;
  initialCapital: number;
  riskRatio: number;
  annualFundingRate?: number;
}

export interface EquityPoint {
  date: Date;
  equity: number;
}

export interface BacktestResult {
  trades: BacktestTrade[];
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

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / DAY_MS);
}

function computePnlUsd(
  side: "long" | "short",
  effEntry: number,
  effExit: number,
  units: number,
): number {
  const delta = side === "long" ? effExit - effEntry : effEntry - effExit;
  return delta * units;
}

function indexSignalsByDate(signals: EntrySignal[]): Map<number, EntrySignal> {
  const map = new Map<number, EntrySignal>();
  for (const sig of signals) {
    const key = sig.date.getTime();
    if (!map.has(key)) {
      map.set(key, sig);
    }
  }
  return map;
}

export function runBacktest<P>(input: BacktestInput<P>): BacktestResult {
  const {
    bars,
    asset,
    strategy,
    params,
    initialCapital,
    riskRatio,
    annualFundingRate = 0,
  } = input;

  const trades: BacktestTrade[] = [];
  const equityCurve: EquityPoint[] = [];

  if (bars.length === 0) {
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

  const signals = strategy.generateSignals(bars, asset, params);
  const signalMap = indexSignalsByDate(signals);

  let cash = initialCapital;
  let position: PositionState | null = null;

  for (let i = 0; i < bars.length; i++) {
    const curBar = bars[i];

    if (position !== null) {
      const daysHeld = daysBetween(position.entryDate, curBar.date);
      const { newState, exit } = evaluateExit(
        position,
        curBar,
        daysHeld,
        strategy.exitConfig,
      );
      position = newState;

      if (exit.exited && exit.exitPrice !== undefined && exit.exitReason) {
        const rawExit = exit.exitPrice;
        const effExit = applyFee(asset, position.side, "exit", rawExit);
        const holdingDays = daysHeld;
        const pnlPrice = computePnlUsd(
          position.side,
          position.entryPrice,
          effExit,
          position.units,
        );
        const funding = calcFundingCost(
          asset,
          position.side,
          position.units,
          position.entryPrice,
          holdingDays,
          annualFundingRate,
        );
        const pnlUsd = pnlPrice + funding;

        trades.push({
          asset,
          strategy: strategy.name,
          side: position.side,
          entryDate: position.entryDate,
          entryPrice: position.entryPrice,
          exitDate: curBar.date,
          exitPrice: effExit,
          exitReason: exit.exitReason as ExitReason,
          sizeUnits: position.units,
          pnlUsd,
          holdingDays,
        });

        cash += pnlUsd;
        position = null;
      }
    }

    if (position === null) {
      const sig = signalMap.get(curBar.date.getTime());
      if (sig && Number.isFinite(curBar.close) && sig.atr > 0) {
        const slDistance = strategy.exitConfig.slAtrMultiplier * sig.atr;
        const sizeUnits = calcPositionUnits({
          equity: cash,
          riskRatio,
          slDistance,
        });
        if (sizeUnits > 0) {
          const effEntry = applyFee(asset, sig.side, "entry", curBar.close);
          const initialSl =
            sig.side === "long" ? effEntry - slDistance : effEntry + slDistance;
          position = {
            asset,
            side: sig.side,
            entryDate: curBar.date,
            entryPrice: effEntry,
            entryAtr: sig.atr,
            units: sizeUnits,
            currentSl: initialSl,
            highSinceEntry: curBar.high,
            lowSinceEntry: curBar.low,
            hasBreakEven: false,
          };
        }
      }
    }

    let unrealized = 0;
    if (position !== null) {
      const holdDays = daysBetween(position.entryDate, curBar.date);
      const effHypoExit = applyFee(asset, position.side, "exit", curBar.close);
      const pnlPrice = computePnlUsd(
        position.side,
        position.entryPrice,
        effHypoExit,
        position.units,
      );
      const funding = calcFundingCost(
        asset,
        position.side,
        position.units,
        position.entryPrice,
        holdDays,
        annualFundingRate,
      );
      unrealized = pnlPrice + funding;
    }
    equityCurve.push({ date: curBar.date, equity: cash + unrealized });
  }

  if (position !== null) {
    const lastBar = bars[bars.length - 1];
    const effExit = applyFee(asset, position.side, "exit", lastBar.close);
    const holdingDays = daysBetween(position.entryDate, lastBar.date);
    const pnlPrice = computePnlUsd(
      position.side,
      position.entryPrice,
      effExit,
      position.units,
    );
    const funding = calcFundingCost(
      asset,
      position.side,
      position.units,
      position.entryPrice,
      holdingDays,
      annualFundingRate,
    );
    const pnlUsd = pnlPrice + funding;

    trades.push({
      asset,
      strategy: strategy.name,
      side: position.side,
      entryDate: position.entryDate,
      entryPrice: position.entryPrice,
      exitDate: lastBar.date,
      exitPrice: effExit,
      exitReason: "end_of_data",
      sizeUnits: position.units,
      pnlUsd,
      holdingDays,
    });

    cash += pnlUsd;
    position = null;

    if (equityCurve.length > 0) {
      equityCurve[equityCurve.length - 1] = {
        date: lastBar.date,
        equity: cash,
      };
    }
  }

  const finalEquity =
    equityCurve.length > 0
      ? equityCurve[equityCurve.length - 1].equity
      : initialCapital;
  const totalReturn = (finalEquity - initialCapital) / initialCapital;

  const returns: number[] = [];
  for (let i = 1; i < equityCurve.length; i++) {
    const prev = equityCurve[i - 1].equity;
    if (prev !== 0) {
      returns.push((equityCurve[i].equity - prev) / prev);
    }
  }
  const sharpe = sharpeRatio(returns);
  const mdd = maxDrawdown(equityCurve.map((p) => p.equity));

  const firstDate = equityCurve[0]?.date ?? bars[0].date;
  const lastDate =
    equityCurve[equityCurve.length - 1]?.date ?? bars[bars.length - 1].date;
  const years = (lastDate.getTime() - firstDate.getTime()) / (365.25 * DAY_MS);
  const annualized = annualReturn(totalReturn, years);
  const mar = marRatio(annualized, mdd);

  const pnls = trades.map((t) => t.pnlUsd);
  const pf = profitFactor(pnls);
  const wr = winRate(pnls);
  const exp = expectancy(pnls);

  return {
    trades,
    equityCurve,
    totalReturn,
    sharpe,
    mar,
    profitFactor: pf,
    maxDrawdown: mdd,
    winRate: wr,
    expectancy: exp,
    tradeCount: trades.length,
  };
}
