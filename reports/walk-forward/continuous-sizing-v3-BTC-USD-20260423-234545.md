# Walk-Forward Report: Continuous Sizing v3 (4-signal +TNX, BTC-USD)

**Period:** 2016-04-23 – 2026-04-23 (10y full)
**Signals:** Onchain + DXY + VIX + TNX yield
**Windows:** 18
**Robustness:** FAIL

## Comparison (10y)

| Strategy | OOS Sharpe | OOS Max DD | IS→OOS Drop | Beats BH? |
|---|---|---|---|---|
| BH 10y | 1.102 | 83.40% | — | baseline |
| R4d Step 3 (3-sig) | 0.903 | 47.91% | 29.3% | NO |
| **R6 v3 (+TNX)** | **0.930** | **36.22%** | **30.5%** | **NO** |

## R6 v3 OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | 0.930 |
| OOS Avg MAR | 5.531 |
| OOS Avg PF | 1.141 |
| OOS Max DD | 36.22% |
| OOS Avg Total Return | 25.79% |
| IS->OOS Drop | 30.54% |

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
| 0 | 16-04-24->17-04-23 | 17-04-24->17-10-22 | nvtLookback=14, aaLookback=30, percentileWindow=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=25, rebalanceThreshold=0.05 | 2.03 | 3.98 | 30.33 | 1.71 | 20.1% |
| 1 | 16-10-23->17-10-22 | 17-10-23->18-04-22 | nvtLookback=14, aaLookback=30, percentileWindow=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=25, rebalanceThreshold=0.05 | 3.13 | 1.61 | 2.97 | 1.17 | 36.2% |
| 2 | 17-04-23->18-04-22 | 18-04-23->18-10-21 | nvtLookback=14, aaLookback=30, percentileWindow=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=35, rebalanceThreshold=0.05 | 2.61 | -0.65 | -0.97 | 0.89 | 21.5% |
| 3 | 17-10-22->18-10-21 | 18-10-22->19-04-21 | nvtLookback=14, aaLookback=30, percentileWindow=365, tnxLookback=365, dxySmaPeriod=100, vixThreshold=25, rebalanceThreshold=0.1 | 1.07 | 0.15 | -0.05 | 0.99 | 29.8% |
| 4 | 18-04-22->19-04-21 | 19-04-22->19-10-20 | nvtLookback=14, aaLookback=30, percentileWindow=365, tnxLookback=365, dxySmaPeriod=100, vixThreshold=35, rebalanceThreshold=0.2 | 0.14 | 1.30 | 2.61 | 1.12 | 32.5% |
| 5 | 18-10-21->19-10-20 | 19-10-21->20-04-19 | nvtLookback=14, aaLookback=30, percentileWindow=365, tnxLookback=365, dxySmaPeriod=100, vixThreshold=25, rebalanceThreshold=0.1 | 1.04 | -0.06 | -0.45 | 0.95 | 32.2% |
| 6 | 19-04-21->20-04-19 | 20-04-20->20-10-18 | nvtLookback=14, aaLookback=30, percentileWindow=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=25, rebalanceThreshold=0.05 | 0.85 | 2.25 | 8.45 | 1.38 | 9.7% |
| 7 | 19-10-20->20-10-18 | 20-10-19->21-04-18 | nvtLookback=14, aaLookback=30, percentileWindow=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=35, rebalanceThreshold=0.05 | 1.04 | 4.39 | 33.03 | 1.70 | 16.2% |
| 8 | 20-04-19->21-04-18 | 21-04-19->21-10-17 | nvtLookback=14, aaLookback=30, percentileWindow=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=30, rebalanceThreshold=0.05 | 3.32 | 0.83 | 1.07 | 1.11 | 27.7% |
| 9 | 20-10-18->21-10-17 | 21-10-18->22-04-17 | nvtLookback=14, aaLookback=30, percentileWindow=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=35, rebalanceThreshold=0.05 | 2.54 | -1.17 | -1.26 | 0.82 | 27.6% |
| 10 | 21-04-18->22-04-17 | 22-04-18->22-10-16 | nvtLookback=14, aaLookback=30, percentileWindow=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=35, rebalanceThreshold=0.1 | 0.12 | -1.99 | -1.61 | 0.71 | 31.7% |
| 11 | 21-10-17->22-10-16 | 22-10-17->23-04-16 | nvtLookback=14, aaLookback=30, percentileWindow=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=35, rebalanceThreshold=0.1 | -1.33 | 1.89 | 4.66 | 1.37 | 15.2% |
| 12 | 22-04-17->23-04-16 | 23-04-17->23-10-15 | nvtLookback=14, aaLookback=30, percentileWindow=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=30, rebalanceThreshold=0.2 | 0.62 | -0.37 | -0.75 | 0.93 | 10.9% |
| 13 | 22-10-16->23-10-15 | 23-10-16->24-04-14 | nvtLookback=14, aaLookback=30, percentileWindow=365, tnxLookback=365, dxySmaPeriod=100, vixThreshold=30, rebalanceThreshold=0.1 | 1.06 | 3.17 | 15.25 | 1.53 | 8.6% |
| 14 | 23-04-16->24-04-14 | 24-04-15->24-10-13 | nvtLookback=14, aaLookback=30, percentileWindow=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=25, rebalanceThreshold=0.2 | 1.75 | 0.18 | 0.07 | 1.01 | 13.8% |
| 15 | 23-10-15->24-10-13 | 24-10-14->25-04-13 | nvtLookback=14, aaLookback=30, percentileWindow=365, tnxLookback=365, dxySmaPeriod=100, vixThreshold=25, rebalanceThreshold=0.2 | 1.70 | 1.47 | 2.92 | 1.20 | 16.4% |
| 16 | 24-04-14->25-04-13 | 25-04-14->25-10-12 | nvtLookback=14, aaLookback=30, percentileWindow=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=30, rebalanceThreshold=0.05 | 0.70 | 1.74 | 4.79 | 1.26 | 8.0% |
| 17 | 24-10-13->25-10-12 | 25-10-13->26-04-12 | nvtLookback=14, aaLookback=30, percentileWindow=365, tnxLookback=365, dxySmaPeriod=200, vixThreshold=30, rebalanceThreshold=0.2 | 1.72 | -1.99 | -1.51 | 0.72 | 30.3% |