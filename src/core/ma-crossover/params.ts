export interface MaCrossoverParams {
  shortEma: number;
  longEma: number;
  atrPeriod: number;
}

export const maCrossoverDefaults: MaCrossoverParams = {
  shortEma: 20,
  longEma: 50,
  atrPeriod: 14,
};
