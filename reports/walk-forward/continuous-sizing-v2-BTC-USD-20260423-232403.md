# Walk-Forward Report: Continuous Sizing v2 (4-signal, BTC-USD)

**Period:** 2019-10-01 – 2026-04-23 (6.5y, funding data limited)
**Signals:** Onchain + DXY + VIX + Funding Rate
**Windows:** 11
**Robustness:** FAIL

## Comparison

| Strategy | OOS Sharpe | OOS Max DD | IS→OOS Drop | Beats BH? |
|---|---|---|---|---|
| BH (6.5y baseline) | 0.871 | 76.63% | — | baseline |
| R4d Step 3 (3-signal) | 0.747 | 46.84% | 38.2% | NO |
| **R5 v2 (4-signal)** | **0.933** | **43.92%** | **24.3%** | **YES ★** |

## R5 v2 OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | 0.933 |
| OOS Avg MAR | 5.812 |
| OOS Avg PF | 1.161 |
| OOS Max DD | 43.92% |
| OOS Avg Total Return | 19.54% |
| IS->OOS Drop | 24.27% |

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
  "fundingLookback": [
    180,
    365
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
| 0 | 19-10-01->20-09-29 | 20-09-30->21-03-30 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=30, fundingLookback=180, rebalanceThreshold=0.05 | 0.70 | 4.75 | 33.52 | 1.86 | 13.2% |
| 1 | 20-03-31->21-03-30 | 21-03-31->21-09-28 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=30, fundingLookback=365, rebalanceThreshold=0.2 | 3.68 | -0.01 | -0.36 | 0.96 | 29.9% |
| 2 | 20-09-29->21-09-28 | 21-09-29->22-03-29 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=30, fundingLookback=180, rebalanceThreshold=0.2 | 1.97 | 1.09 | 1.47 | 1.14 | 28.3% |
| 3 | 21-03-30->22-03-29 | 22-03-30->22-09-27 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=30, fundingLookback=365, rebalanceThreshold=0.1 | 0.62 | -2.45 | -1.54 | 0.65 | 43.9% |
| 4 | 21-09-28->22-09-27 | 22-09-28->23-03-28 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=25, fundingLookback=180, rebalanceThreshold=0.05 | -0.54 | 1.58 | 3.94 | 1.29 | 14.1% |
| 5 | 22-03-29->23-03-28 | 23-03-29->23-09-26 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=25, fundingLookback=180, rebalanceThreshold=0.1 | -0.37 | -0.12 | -0.42 | 0.96 | 13.0% |
| 6 | 22-09-27->23-09-26 | 23-09-27->24-03-26 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=100, vixThreshold=30, fundingLookback=365, rebalanceThreshold=0.2 | 1.16 | 3.73 | 20.72 | 1.71 | 11.0% |
| 7 | 23-03-28->24-03-26 | 24-03-27->24-09-24 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=100, vixThreshold=30, fundingLookback=365, rebalanceThreshold=0.05 | 2.15 | 0.21 | 0.08 | 1.01 | 16.4% |
| 8 | 23-09-26->24-09-24 | 24-09-25->25-03-25 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=30, fundingLookback=365, rebalanceThreshold=0.1 | 2.02 | 1.40 | 2.85 | 1.18 | 16.5% |
| 9 | 24-03-26->25-03-25 | 25-03-26->25-09-23 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=30, fundingLookback=365, rebalanceThreshold=0.1 | 0.72 | 1.59 | 4.93 | 1.24 | 6.8% |
| 10 | 24-09-24->25-09-23 | 25-09-24->26-03-24 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=30, fundingLookback=365, rebalanceThreshold=0.1 | 1.46 | -1.50 | -1.26 | 0.77 | 35.3% |