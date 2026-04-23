export interface PositionSizerArgs {
  equity: number;
  riskRatio: number;
  slDistance: number;
}

/**
 * リスク金額 ÷ SL 距離で units を計算する。
 * crypto は fractional units 許容のため floor は行わない。
 */
export function calcPositionUnits(args: PositionSizerArgs): number {
  if (args.slDistance <= 0) return 0;
  if (args.equity <= 0 || args.riskRatio <= 0) return 0;
  const riskUsd = args.equity * args.riskRatio;
  return riskUsd / args.slDistance;
}
