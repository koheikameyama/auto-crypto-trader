export interface Nr7Params {
  lookback: number;
  atrPeriod: number;
}

export const nr7Defaults: Nr7Params = {
  lookback: 7,
  atrPeriod: 14,
};
