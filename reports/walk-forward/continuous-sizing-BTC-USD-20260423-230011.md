# Walk-Forward Report: Continuous Sizing (BTC-USD)

**Period:** 2016-04-23 – 2026-04-23
**Signals:** Onchain + DXY + VIX (soft-weighted)
**Windows:** 18
**IS/OOS/step:** 365/182/182
**Robustness:** FAIL
**BH Sharpe:** 1.102 | Beats BH: NO

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | 0.903 |
| OOS Avg MAR | 5.448 |
| OOS Avg PF | 1.126 |
| OOS Max DD | 47.91% |
| OOS Avg Total Return | 27.42% |
| IS->OOS Drop | 29.28% |

## Parameter Grid

```json
{
  "dxySmaPeriod": [
    100,
    200
  ],
  "vixThreshold": [
    25,
    30,
    35
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
| 0 | 16-04-24->17-04-23 | 17-04-24->17-10-22 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=100, vixThreshold=25, rebalanceThreshold=0.05 | 2.04 | 3.88 | 28.47 | 1.66 | 27.2% |
| 1 | 16-10-23->17-10-22 | 17-10-23->18-04-22 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=100, vixThreshold=30, rebalanceThreshold=0.1 | 3.13 | 1.40 | 2.46 | 1.12 | 47.9% |
| 2 | 17-04-23->18-04-22 | 18-04-23->18-10-21 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=25, rebalanceThreshold=0.1 | 2.48 | -0.66 | -1.01 | 0.88 | 26.6% |
| 3 | 17-10-22->18-10-21 | 18-10-22->19-04-21 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=35, rebalanceThreshold=0.1 | 0.83 | -0.29 | -0.56 | 0.89 | 38.7% |
| 4 | 18-04-22->19-04-21 | 19-04-22->19-10-20 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=30, rebalanceThreshold=0.2 | -0.35 | 1.28 | 2.51 | 1.12 | 31.5% |
| 5 | 18-10-21->19-10-20 | 19-10-21->20-04-19 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=25, rebalanceThreshold=0.2 | 0.97 | 0.15 | -0.11 | 0.99 | 25.6% |
| 6 | 19-04-21->20-04-19 | 20-04-20->20-10-18 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=100, vixThreshold=35, rebalanceThreshold=0.2 | 0.99 | 2.14 | 6.80 | 1.34 | 12.4% |
| 7 | 19-10-20->20-10-18 | 20-10-19->21-04-18 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=35, rebalanceThreshold=0.05 | 1.14 | 4.23 | 33.26 | 1.65 | 16.0% |
| 8 | 20-04-19->21-04-18 | 21-04-19->21-10-17 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=35, rebalanceThreshold=0.05 | 3.28 | 0.85 | 1.09 | 1.11 | 32.6% |
| 9 | 20-10-18->21-10-17 | 21-10-18->22-04-17 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=35, rebalanceThreshold=0.05 | 2.32 | -1.19 | -1.30 | 0.81 | 33.3% |
| 10 | 21-04-18->22-04-17 | 22-04-18->22-10-16 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=35, rebalanceThreshold=0.05 | 0.06 | -2.06 | -1.53 | 0.69 | 42.3% |
| 11 | 21-10-17->22-10-16 | 22-10-17->23-04-16 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=100, vixThreshold=30, rebalanceThreshold=0.2 | -1.48 | 2.08 | 5.53 | 1.39 | 16.9% |
| 12 | 22-04-17->23-04-16 | 23-04-17->23-10-15 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=30, rebalanceThreshold=0.2 | 0.39 | -0.24 | -0.59 | 0.95 | 12.7% |
| 13 | 22-10-16->23-10-15 | 23-10-16->24-04-14 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=100, vixThreshold=35, rebalanceThreshold=0.1 | 0.98 | 3.22 | 17.06 | 1.52 | 10.1% |
| 14 | 23-04-16->24-04-14 | 24-04-15->24-10-13 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=30, rebalanceThreshold=0.2 | 1.80 | 0.20 | 0.09 | 1.01 | 16.4% |
| 15 | 23-10-15->24-10-13 | 24-10-14->25-04-13 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=35, rebalanceThreshold=0.2 | 1.94 | 1.46 | 3.10 | 1.19 | 16.5% |
| 16 | 24-04-14->25-04-13 | 25-04-14->25-10-12 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=25, rebalanceThreshold=0.2 | 0.76 | 1.63 | 4.28 | 1.24 | 8.5% |
| 17 | 24-10-13->25-10-12 | 25-10-13->26-04-12 | nvtLookback=14, aaLookback=30, percentileWindow=365, dxySmaPeriod=200, vixThreshold=30, rebalanceThreshold=0.1 | 1.71 | -1.83 | -1.49 | 0.73 | 33.2% |