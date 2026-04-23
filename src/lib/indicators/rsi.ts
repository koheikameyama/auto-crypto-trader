import { RSI } from "technicalindicators";

export function computeRSI(values: number[], period: number): (number | null)[] {
  const calculated = RSI.calculate({ period, values });
  const pad = values.length - calculated.length;
  const result: (number | null)[] = new Array(pad).fill(null);
  for (const v of calculated) result.push(v);
  return result;
}
