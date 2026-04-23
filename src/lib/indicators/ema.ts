import { EMA } from "technicalindicators";

export function computeEMA(values: number[], period: number): (number | null)[] {
  const calculated = EMA.calculate({ period, values });
  const pad = values.length - calculated.length;
  const result: (number | null)[] = new Array(pad).fill(null);
  for (const v of calculated) result.push(v);
  return result;
}
