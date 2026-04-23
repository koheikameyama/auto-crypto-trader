# Walk-Forward Report: donchian-tf / BTC-USD

**Period:** 2016-04-23 - 2026-04-23
**Windows:** 18
**Robustness:** FAIL
**Buy & Hold Sharpe:** 1.102 (strategy beats BH: NO)
**Failure reasons:**
- OOS Sharpe 0.621 < min 1
- IS->OOS Sharpe drop 59.07% > max 30.00%

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | 0.621 |
| OOS Avg MAR | 4.002 |
| OOS Avg PF | 2.311 |
| OOS Max DD | 5.19% |
| OOS Avg Total Return | 2.36% |
| IS->OOS Sharpe Drop | 59.07% |

## Buy & Hold Benchmark

| Metric | Value |
|---|---|
| BH Sharpe | 1.102 |
| BH MAR | 0.806 |
| BH Total Return | 16954.25% |
| BH Annualized | 67.24% |
| BH Max DD | 83.40% |

## Parameter Grid

```json
{
  "entryPeriod": [
    10,
    20,
    30,
    55
  ],
  "exitPeriod": [
    10,
    20,
    55
  ],
  "atrPeriod": [
    14
  ]
}
```

## Windows

| # | IS Period | OOS Period | Best Params | IS Sharpe | OOS Sharpe | OOS MAR | OOS PF | OOS DD | OOS Trades |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 16-04-24->17-04-23 | 17-04-24->17-10-22 | entryPeriod=20, exitPeriod=10, atrPeriod=14 | 2.66 | 1.67 | 3.24 | 2.99 | 2.7% | 9 |
| 1 | 16-10-23->17-10-22 | 17-10-23->18-04-22 | entryPeriod=10, exitPeriod=10, atrPeriod=14 | 3.62 | -1.43 | -2.00 | 0.35 | 2.1% | 10 |
| 2 | 17-04-23->18-04-22 | 18-04-23->18-10-21 | entryPeriod=20, exitPeriod=10, atrPeriod=14 | 1.93 | -0.64 | -0.76 | 0.57 | 4.8% | 10 |
| 3 | 17-10-22->18-10-21 | 18-10-22->19-04-21 | entryPeriod=55, exitPeriod=10, atrPeriod=14 | -0.60 | 0.15 | 0.37 | 1.10 | 1.1% | 3 |
| 4 | 18-04-22->19-04-21 | 19-04-22->19-10-20 | entryPeriod=30, exitPeriod=10, atrPeriod=14 | 1.56 | 2.93 | 43.42 | 10.00 | 0.4% | 3 |
| 5 | 18-10-21->19-10-20 | 19-10-21->20-04-19 | entryPeriod=30, exitPeriod=10, atrPeriod=14 | 2.27 | 0.69 | 1.53 | 2.17 | 1.8% | 7 |
| 6 | 19-04-21->20-04-19 | 20-04-20->20-10-18 | entryPeriod=20, exitPeriod=10, atrPeriod=14 | 1.93 | 1.46 | 4.47 | 4.14 | 3.4% | 7 |
| 7 | 19-10-20->20-10-18 | 20-10-19->21-04-18 | entryPeriod=30, exitPeriod=10, atrPeriod=14 | 1.21 | 2.00 | 6.48 | 2.84 | 1.9% | 10 |
| 8 | 20-04-19->21-04-18 | 21-04-19->21-10-17 | entryPeriod=10, exitPeriod=10, atrPeriod=14 | 1.96 | -0.47 | -0.57 | 0.80 | 5.0% | 14 |
| 9 | 20-10-18->21-10-17 | 21-10-18->22-04-17 | entryPeriod=10, exitPeriod=10, atrPeriod=14 | 1.60 | 1.58 | 3.56 | 3.59 | 1.7% | 7 |
| 10 | 21-04-18->22-04-17 | 22-04-18->22-10-16 | entryPeriod=10, exitPeriod=10, atrPeriod=14 | 0.03 | 1.15 | 2.49 | 2.51 | 2.7% | 6 |
| 11 | 21-10-17->22-10-16 | 22-10-17->23-04-16 | entryPeriod=10, exitPeriod=10, atrPeriod=14 | 1.26 | 2.44 | 7.75 | 4.64 | 3.0% | 11 |
| 12 | 22-04-17->23-04-16 | 23-04-17->23-10-15 | entryPeriod=10, exitPeriod=10, atrPeriod=14 | 1.93 | 0.57 | 1.93 | 1.38 | 2.1% | 7 |
| 13 | 22-10-16->23-10-15 | 23-10-16->24-04-14 | entryPeriod=10, exitPeriod=10, atrPeriod=14 | 1.52 | 0.79 | 1.31 | 1.42 | 4.7% | 14 |
| 14 | 23-04-16->24-04-14 | 24-04-15->24-10-13 | entryPeriod=10, exitPeriod=10, atrPeriod=14 | 1.43 | 0.65 | 0.86 | 1.28 | 4.1% | 12 |
| 15 | 23-10-15->24-10-13 | 24-10-14->25-04-13 | entryPeriod=20, exitPeriod=10, atrPeriod=14 | 1.53 | -0.34 | -0.50 | 0.65 | 1.5% | 5 |
| 16 | 24-04-14->25-04-13 | 25-04-14->25-10-12 | entryPeriod=20, exitPeriod=10, atrPeriod=14 | 1.17 | 0.18 | 0.13 | 1.06 | 5.2% | 7 |
| 17 | 24-10-13->25-10-12 | 25-10-13->26-04-12 | entryPeriod=30, exitPeriod=10, atrPeriod=14 | 0.32 | -2.18 | -1.66 | 0.09 | 3.4% | 6 |