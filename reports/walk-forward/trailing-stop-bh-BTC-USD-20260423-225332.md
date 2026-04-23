# Walk-Forward Report: Trailing Stop BH (BTC-USD)

**Period:** 2016-04-23 – 2026-04-23
**Windows:** 18
**IS/OOS/step:** 365/182/182
**Robustness:** FAIL
**BH Sharpe:** 1.102 | Beats BH: NO

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | 0.655 |
| OOS Avg MAR | 9.005 |
| OOS Avg PF | 3.782 |
| OOS Max DD | 60.14% |
| OOS Avg Total Return | 46.93% |
| IS->OOS Sharpe Drop | 55.44% |

## BH Benchmark (full 10y)

| Metric | Value |
|---|---|
| BH Sharpe | 1.102 |
| BH MAR | 0.806 |
| BH Total Return | 16954.25% |
| BH Max DD | 83.40% |

## Parameter Grid

```json
{
  "trailDrawdown": [
    20,
    30,
    40
  ],
  "reentryGain": [
    10,
    20,
    30
  ]
}
```

## Windows

| # | IS Period | OOS Period | Best Params | IS Sharpe | OOS Sharpe | OOS MAR | OOS PF | OOS DD | OOS Trades |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 16-04-24->17-04-23 | 17-04-24->17-10-22 | trailDrawdown=40, reentryGain=10 | 1.99 | 3.87 | 63.83 | 10.00 | 35.5% | 1 |
| 1 | 16-10-23->17-10-22 | 17-10-23->18-04-22 | trailDrawdown=20, reentryGain=10 | 3.46 | 1.08 | 1.36 | 1.31 | 59.5% | 7 |
| 2 | 17-04-23->18-04-22 | 18-04-23->18-10-21 | trailDrawdown=20, reentryGain=20 | 3.00 | -1.60 | -1.39 | 0.00 | 34.2% | 2 |
| 3 | 17-10-22->18-10-21 | 18-10-22->19-04-21 | trailDrawdown=20, reentryGain=20 | 0.74 | 0.10 | -0.20 | 0.85 | 38.8% | 2 |
| 4 | 18-04-22->19-04-21 | 19-04-22->19-10-20 | trailDrawdown=20, reentryGain=20 | 0.06 | 1.59 | 3.65 | 2.41 | 36.7% | 2 |
| 5 | 18-10-21->19-10-20 | 19-10-21->20-04-19 | trailDrawdown=20, reentryGain=30 | 1.17 | -0.37 | -0.67 | 0.28 | 38.6% | 3 |
| 6 | 19-04-21->20-04-19 | 20-04-20->20-10-18 | trailDrawdown=20, reentryGain=30 | 1.47 | 2.28 | 10.38 | 10.00 | 17.3% | 1 |
| 7 | 19-10-20->20-10-18 | 20-10-19->21-04-18 | trailDrawdown=20, reentryGain=10 | 1.38 | 3.98 | 51.16 | 10.00 | 27.2% | 3 |
| 8 | 20-04-19->21-04-18 | 21-04-19->21-10-17 | trailDrawdown=30, reentryGain=10 | 3.43 | 0.41 | -0.01 | 0.99 | 54.1% | 2 |
| 9 | 20-10-18->21-10-17 | 21-10-18->22-04-17 | trailDrawdown=30, reentryGain=30 | 2.90 | -2.28 | -1.43 | 0.00 | 41.1% | 2 |
| 10 | 21-04-18->22-04-17 | 22-04-18->22-10-16 | trailDrawdown=20, reentryGain=10 | 0.14 | -2.90 | -1.37 | 0.00 | 60.1% | 4 |
| 11 | 21-10-17->22-10-16 | 22-10-17->23-04-16 | trailDrawdown=20, reentryGain=20 | -0.98 | 1.12 | 2.05 | 2.22 | 25.5% | 2 |
| 12 | 22-04-17->23-04-16 | 23-04-17->23-10-15 | trailDrawdown=20, reentryGain=30 | 0.45 | -0.78 | -1.36 | 0.00 | 20.1% | 1 |
| 13 | 22-10-16->23-10-15 | 23-10-16->24-04-14 | trailDrawdown=30, reentryGain=10 | 0.98 | 3.35 | 27.51 | 10.00 | 15.9% | 1 |
| 14 | 23-04-16->24-04-14 | 24-04-15->24-10-13 | trailDrawdown=30, reentryGain=10 | 1.89 | 0.20 | -0.09 | 0.00 | 24.5% | 1 |
| 15 | 23-10-15->24-10-13 | 24-10-14->25-04-13 | trailDrawdown=20, reentryGain=30 | 2.08 | 1.39 | 3.06 | 10.00 | 20.6% | 1 |
| 16 | 24-04-14->25-04-13 | 25-04-14->25-10-12 | trailDrawdown=30, reentryGain=10 | 0.72 | 2.01 | 7.01 | 10.00 | 12.2% | 1 |
| 17 | 24-10-13->25-10-12 | 25-10-13->26-04-12 | trailDrawdown=30, reentryGain=10 | 1.58 | -1.66 | -1.41 | 0.00 | 38.2% | 2 |