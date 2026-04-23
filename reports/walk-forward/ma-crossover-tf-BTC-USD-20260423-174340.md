# Walk-Forward Report: ma-crossover-tf / BTC-USD

**Period:** 2016-04-23 - 2026-04-23
**Windows:** 18
**Robustness:** FAIL
**Buy & Hold Sharpe:** 1.102 (strategy beats BH: NO)
**Failure reasons:**
- OOS Sharpe 0.310 < min 1
- IS->OOS Sharpe drop 63.22% > max 30.00%

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | 0.310 |
| OOS Avg MAR | 3.185 |
| OOS Avg PF | 25.740 |
| OOS Max DD | 4.56% |
| OOS Avg Total Return | 1.15% |
| IS->OOS Sharpe Drop | 63.22% |

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
  "shortEma": [
    10,
    20,
    30
  ],
  "longEma": [
    50,
    100,
    200
  ],
  "atrPeriod": [
    14
  ]
}
```

## Windows

| # | IS Period | OOS Period | Best Params | IS Sharpe | OOS Sharpe | OOS MAR | OOS PF | OOS DD | OOS Trades |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 16-04-24->17-04-23 | 17-04-24->17-10-22 | shortEma=10, longEma=50, atrPeriod=14 | 0.43 | -2.57 | -1.74 | 0.00 | 4.6% | 6 |
| 1 | 16-10-23->17-10-22 | 17-10-23->18-04-22 | shortEma=10, longEma=50, atrPeriod=14 | -0.43 | -1.24 | -1.60 | 0.13 | 1.1% | 3 |
| 2 | 17-04-23->18-04-22 | 18-04-23->18-10-21 | shortEma=10, longEma=50, atrPeriod=14 | -1.97 | 1.34 | 7.30 | 115.61 | 1.0% | 4 |
| 3 | 17-10-22->18-10-21 | 18-10-22->19-04-21 | shortEma=10, longEma=50, atrPeriod=14 | 0.49 | 0.63 | 2.40 | 10.00 | 0.7% | 1 |
| 4 | 18-04-22->19-04-21 | 19-04-22->19-10-20 | shortEma=10, longEma=50, atrPeriod=14 | 0.91 | -0.66 | -0.90 | 0.35 | 1.5% | 2 |
| 5 | 18-10-21->19-10-20 | 19-10-21->20-04-19 | shortEma=10, longEma=100, atrPeriod=14 | 1.45 | -0.51 | -1.01 | 0.00 | 0.0% | 1 |
| 6 | 19-04-21->20-04-19 | 20-04-20->20-10-18 | shortEma=30, longEma=50, atrPeriod=14 | -0.59 | -0.74 | -1.22 | 0.34 | 1.1% | 2 |
| 7 | 19-10-20->20-10-18 | 20-10-19->21-04-18 | shortEma=10, longEma=50, atrPeriod=14 | 1.73 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 8 | 20-04-19->21-04-18 | 21-04-19->21-10-17 | shortEma=10, longEma=50, atrPeriod=14 | 1.51 | 1.53 | 4.17 | 10.00 | 1.5% | 3 |
| 9 | 20-10-18->21-10-17 | 21-10-18->22-04-17 | shortEma=10, longEma=50, atrPeriod=14 | 0.67 | 1.73 | 3.68 | 10.00 | 1.3% | 2 |
| 10 | 21-04-18->22-04-17 | 22-04-18->22-10-16 | shortEma=20, longEma=50, atrPeriod=14 | 2.33 | 0.48 | 1.50 | 10.00 | 0.8% | 2 |
| 11 | 21-10-17->22-10-16 | 22-10-17->23-04-16 | shortEma=10, longEma=50, atrPeriod=14 | 0.99 | 1.89 | 11.94 | 210.69 | 1.1% | 3 |
| 12 | 22-04-17->23-04-16 | 23-04-17->23-10-15 | shortEma=10, longEma=50, atrPeriod=14 | 0.73 | 2.20 | 27.31 | 92.43 | 0.5% | 4 |
| 13 | 22-10-16->23-10-15 | 23-10-16->24-04-14 | shortEma=10, longEma=50, atrPeriod=14 | 2.00 | -0.15 | -0.32 | 0.00 | 0.3% | 2 |
| 14 | 23-04-16->24-04-14 | 24-04-15->24-10-13 | shortEma=10, longEma=50, atrPeriod=14 | 1.52 | 1.69 | 5.92 | 3.77 | 1.1% | 6 |
| 15 | 23-10-15->24-10-13 | 24-10-14->25-04-13 | shortEma=10, longEma=50, atrPeriod=14 | 1.26 | -0.04 | -0.09 | 0.00 | 0.5% | 1 |
| 16 | 24-04-14->25-04-13 | 25-04-14->25-10-12 | shortEma=10, longEma=100, atrPeriod=14 | 1.49 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 17 | 24-10-13->25-10-12 | 25-10-13->26-04-12 | shortEma=30, longEma=50, atrPeriod=14 | 0.64 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |