export interface RsiReversionParams {
  rsiPeriod: number;
  buyThreshold: number;
  sellThreshold: number;
  atrPeriod: number;
}

export const rsiReversionDefaults: RsiReversionParams = {
  rsiPeriod: 14,
  buyThreshold: 30,
  sellThreshold: 70,
  atrPeriod: 14,
};
