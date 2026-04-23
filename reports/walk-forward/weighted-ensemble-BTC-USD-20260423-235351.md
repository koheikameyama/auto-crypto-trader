# Walk-Forward Report: Weighted Ensemble (BTC-USD)

**Period:** 2019-10-01 – 2026-04-23 (6.5y)
**Approach:** Test multiple weight schemes informed by signal correlation analysis

## Weight Schemes Tested

| Scheme | wOnchain | wDxy | wVix | wFunding | wTnx |
|---|---|---|---|---|---|
| Equal-4 (R5 v2 baseline) | 0.25 | 0.25 | 0.25 | 0.25 | 0 |
| A: corr-based 5-sig | 0.15 | 0.4 | 0.2 | 0.2 | 0.05 |
| B: drop weak (3-sig: DXY-heavy) | 0 | 0.5 | 0.25 | 0.25 | 0 |
| C: drop onchain only (4-sig) | 0 | 0.35 | 0.25 | 0.25 | 0.15 |
| D: DXY dominant (3-sig) | 0 | 0.6 | 0.2 | 0.2 | 0 |
| E: DXY + funding pair | 0 | 0.6 | 0 | 0.4 | 0 |

## Results (OOS)

| Scheme | Sharpe | MAR | Max DD | IS→OOS Drop |
|---|---|---|---|---|
| Equal-4 (R5 v2 baseline) | 0.959 | 6.000 | 48.34% | 16.6% |
| A: corr-based 5-sig | 0.913 | 4.803 | 44.17% | 23.0% |
| B: drop weak (3-sig: DXY-heavy) | 0.944 | 6.595 | 48.65% | 22.5% |
| C: drop onchain only (4-sig) | 0.947 | 6.677 | 40.06% | 20.5% |
| D: DXY dominant (3-sig) | 0.941 | 6.314 | 48.65% | 22.9% |
| E: DXY + funding pair | 1.096 | 6.206 | 49.99% | 15.0% |

## BH Benchmark

Sharpe 0.871 | DD 76.63%

## Best Scheme

- **Name:** E: DXY + funding pair
- **Sharpe:** 1.096
- **DD:** 49.99%
- **Drop:** 15.0%
- **Beats BH:** YES
- **Strict criteria pass:** YES ★★