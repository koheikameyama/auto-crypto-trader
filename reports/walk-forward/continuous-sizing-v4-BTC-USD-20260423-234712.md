# Walk-Forward Report: Continuous Sizing v4 (5-signal, BTC-USD)

**Period:** 2019-10-01 – 2026-04-23 (6.5y)
**Signals:** Onchain + DXY + VIX + Funding + TNX
**Windows:** 11
**Robustness:** FAIL

## Comparison (6.5y)

| Strategy | OOS Sharpe | OOS Max DD | IS→OOS Drop | Beats BH? |
|---|---|---|---|---|
| BH 6.5y | 0.871 | 76.63% | — | baseline |
| R5 v2 (4-sig) | 0.933 | 43.92% | 24.3% | YES |
| **R6 v4 (5-sig)** | **0.913** | **34.39%** | **26.8%** | **YES ★** |

## R6 v4 OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | 0.913 |
| OOS Avg MAR | 4.797 |
| OOS Avg PF | 1.165 |
| OOS Max DD | 34.39% |
| OOS Avg Total Return | 17.38% |
| IS->OOS Drop | 26.79% |

## Parameter Grid

```json
{
  "dxySmaPeriod": [
    100,
    200
  ],
  "vixThreshold": [
    25,
    30
  ],
  "rebalanceThreshold": [
    0.05,
    0.1,
    0.2
  ]
}
```

## Windows

| # | IS Period | OOS Period | Best Params | IS Sharpe | OOS Sharpe | OOS MAR | OOS PF | OOS DD |
|---|---|---|---|---|---|---|---|---|
| 0 | 19-10-01->20-09-29 | 20-09-30->21-03-30 | nvtLookback=14, aaLookback=30, percentileWindow=365, fundingLookback=365, tnxLookback=365, dxySmaPeriod=100, vixThreshold=25, rebalanceThreshold=0.1 | 0.64 | 4.22 | 22.53 | 1.72 | 17.1% |
| 1 | 20-03-31->21-03-30 | 21-03-31->21-09-28 | nvtLookback=14, aaLookback=30, percentileWindow=365, fundingLookback=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=30, rebalanceThreshold=0.05 | 3.57 | -0.07 | -0.43 | 0.96 | 27.0% |
| 2 | 20-09-29->21-09-28 | 21-09-29->22-03-29 | nvtLookback=14, aaLookback=30, percentileWindow=365, fundingLookback=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=30, rebalanceThreshold=0.05 | 2.15 | 1.01 | 1.24 | 1.13 | 26.2% |
| 3 | 21-03-30->22-03-29 | 22-03-30->22-09-27 | nvtLookback=14, aaLookback=30, percentileWindow=365, fundingLookback=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=25, rebalanceThreshold=0.05 | 0.50 | -2.48 | -1.63 | 0.66 | 34.4% |
| 4 | 21-09-28->22-09-27 | 22-09-28->23-03-28 | nvtLookback=14, aaLookback=30, percentileWindow=365, fundingLookback=365, tnxLookback=365, dxySmaPeriod=100, vixThreshold=30, rebalanceThreshold=0.2 | -0.54 | 1.99 | 5.38 | 1.38 | 13.1% |
| 5 | 22-03-29->23-03-28 | 23-03-29->23-09-26 | nvtLookback=14, aaLookback=30, percentileWindow=365, fundingLookback=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=30, rebalanceThreshold=0.1 | -0.30 | -0.19 | -0.52 | 0.96 | 11.0% |
| 6 | 22-09-27->23-09-26 | 23-09-27->24-03-26 | nvtLookback=14, aaLookback=30, percentileWindow=365, fundingLookback=365, tnxLookback=365, dxySmaPeriod=100, vixThreshold=30, rebalanceThreshold=0.05 | 1.25 | 4.05 | 19.50 | 1.79 | 7.7% |
| 7 | 23-03-28->24-03-26 | 24-03-27->24-09-24 | nvtLookback=14, aaLookback=30, percentileWindow=365, fundingLookback=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=30, rebalanceThreshold=0.05 | 2.22 | 0.09 | -0.12 | 0.99 | 15.7% |
| 8 | 23-09-26->24-09-24 | 24-09-25->25-03-25 | nvtLookback=14, aaLookback=30, percentileWindow=365, fundingLookback=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=30, rebalanceThreshold=0.05 | 1.87 | 1.51 | 3.26 | 1.21 | 14.6% |
| 9 | 24-03-26->25-03-25 | 25-03-26->25-09-23 | nvtLookback=14, aaLookback=30, percentileWindow=365, fundingLookback=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=30, rebalanceThreshold=0.2 | 0.85 | 1.71 | 4.85 | 1.27 | 7.5% |
| 10 | 24-09-24->25-09-23 | 25-09-24->26-03-24 | nvtLookback=14, aaLookback=30, percentileWindow=365, fundingLookback=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=30, rebalanceThreshold=0.2 | 1.50 | -1.80 | -1.30 | 0.75 | 33.7% |