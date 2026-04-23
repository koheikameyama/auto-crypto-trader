const CRYPTO_ANNUAL_DAYS = 365;

export function sharpeRatio(
  returns: number[],
  annualizationFactor = CRYPTO_ANNUAL_DAYS,
): number {
  if (returns.length === 0) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return (mean / std) * Math.sqrt(annualizationFactor);
}

export function maxDrawdown(equityCurve: number[]): number {
  if (equityCurve.length <= 1) return 0;
  let peak = -Infinity;
  let maxDd = 0;
  for (const v of equityCurve) {
    if (v > peak) peak = v;
    if (peak <= 0) continue;
    const dd = (peak - v) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

export function profitFactor(pnls: number[]): number {
  if (pnls.length === 0) return 0;
  const gains = pnls.filter((p) => p > 0).reduce((a, b) => a + b, 0);
  const losses = pnls.filter((p) => p < 0).reduce((a, b) => a + Math.abs(b), 0);
  if (losses === 0) return gains > 0 ? Infinity : 0;
  return gains / losses;
}

export function expectancy(pnls: number[]): number {
  if (pnls.length === 0) return 0;
  return pnls.reduce((a, b) => a + b, 0) / pnls.length;
}

export function marRatio(annualReturnValue: number, maxDd: number): number {
  if (maxDd <= 0) return 0;
  return annualReturnValue / maxDd;
}

export function annualReturn(totalReturn: number, years: number): number {
  if (years <= 0) return 0;
  return Math.pow(1 + totalReturn, 1 / years) - 1;
}

export function winRate(pnls: number[]): number {
  if (pnls.length === 0) return 0;
  return pnls.filter((p) => p > 0).length / pnls.length;
}
