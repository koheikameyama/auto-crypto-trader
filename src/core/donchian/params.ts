export interface DonchianParams {
  entryPeriod: number;
  exitPeriod: number;
  atrPeriod: number;
}

export const donchianDefaults: DonchianParams = {
  entryPeriod: 20,
  exitPeriod: 55,
  atrPeriod: 14,
};
