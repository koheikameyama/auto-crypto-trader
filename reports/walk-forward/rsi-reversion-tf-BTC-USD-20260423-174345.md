# Walk-Forward Report: rsi-reversion-tf / BTC-USD

**Period:** 2016-04-23 - 2026-04-23
**Windows:** 18
**Robustness:** FAIL
**Buy & Hold Sharpe:** 1.102 (strategy beats BH: NO)
**Failure reasons:**
- OOS Sharpe -0.104 < min 1
- IS->OOS Sharpe drop 112.40% > max 30.00%

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | -0.104 |
| OOS Avg MAR | 1.493 |
| OOS Avg PF | 7.769 |
| OOS Max DD | 1.30% |
| OOS Avg Total Return | 0.05% |
| IS->OOS Sharpe Drop | 112.40% |

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
  "rsiPeriod": [
    7,
    14,
    21
  ],
  "buyThreshold": [
    20,
    25,
    30,
    35
  ],
  "sellThreshold": [
    65,
    70,
    75,
    80
  ],
  "atrPeriod": [
    14
  ]
}
```

## Windows

| # | IS Period | OOS Period | Best Params | IS Sharpe | OOS Sharpe | OOS MAR | OOS PF | OOS DD | OOS Trades |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 16-04-24->17-04-23 | 17-04-24->17-10-22 | rsiPeriod=7, buyThreshold=35, sellThreshold=75, atrPeriod=14 | 1.74 | 0.07 | 0.11 | 1.05 | 1.0% | 2 |
| 1 | 16-10-23->17-10-22 | 17-10-23->18-04-22 | rsiPeriod=7, buyThreshold=35, sellThreshold=65, atrPeriod=14 | 1.37 | 0.26 | 0.65 | 1.36 | 1.2% | 7 |
| 2 | 17-04-23->18-04-22 | 18-04-23->18-10-21 | rsiPeriod=7, buyThreshold=35, sellThreshold=70, atrPeriod=14 | 1.69 | 1.89 | 19.54 | 97.95 | 0.2% | 2 |
| 3 | 17-10-22->18-10-21 | 18-10-22->19-04-21 | rsiPeriod=7, buyThreshold=35, sellThreshold=70, atrPeriod=14 | 1.47 | -0.05 | -0.09 | 0.00 | 1.2% | 2 |
| 4 | 18-04-22->19-04-21 | 19-04-22->19-10-20 | rsiPeriod=7, buyThreshold=20, sellThreshold=65, atrPeriod=14 | 0.71 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 5 | 18-10-21->19-10-20 | 19-10-21->20-04-19 | rsiPeriod=7, buyThreshold=35, sellThreshold=65, atrPeriod=14 | 0.40 | -0.08 | -0.17 | 0.00 | 0.2% | 1 |
| 6 | 19-04-21->20-04-19 | 20-04-20->20-10-18 | rsiPeriod=7, buyThreshold=20, sellThreshold=70, atrPeriod=14 | 0.96 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 7 | 19-10-20->20-10-18 | 20-10-19->21-04-18 | rsiPeriod=7, buyThreshold=20, sellThreshold=70, atrPeriod=14 | 0.96 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 8 | 20-04-19->21-04-18 | 21-04-19->21-10-17 | rsiPeriod=7, buyThreshold=35, sellThreshold=65, atrPeriod=14 | 1.16 | -2.03 | -2.01 | 0.00 | 1.0% | 1 |
| 9 | 20-10-18->21-10-17 | 21-10-18->22-04-17 | rsiPeriod=7, buyThreshold=35, sellThreshold=65, atrPeriod=14 | 0.69 | -1.41 | -1.69 | 0.00 | 1.3% | 4 |
| 10 | 21-04-18->22-04-17 | 22-04-18->22-10-16 | rsiPeriod=7, buyThreshold=35, sellThreshold=70, atrPeriod=14 | -1.45 | -1.49 | -1.78 | 0.00 | 1.2% | 2 |
| 11 | 21-10-17->22-10-16 | 22-10-17->23-04-16 | rsiPeriod=7, buyThreshold=30, sellThreshold=65, atrPeriod=14 | -0.94 | -1.46 | -1.95 | 0.00 | 1.1% | 2 |
| 12 | 22-04-17->23-04-16 | 23-04-17->23-10-15 | rsiPeriod=7, buyThreshold=35, sellThreshold=70, atrPeriod=14 | 0.58 | 1.84 | 12.33 | 29.48 | 0.2% | 3 |
| 13 | 22-10-16->23-10-15 | 23-10-16->24-04-14 | rsiPeriod=7, buyThreshold=35, sellThreshold=75, atrPeriod=14 | 1.87 | 1.01 | 2.59 | 10.00 | 1.1% | 1 |
| 14 | 23-04-16->24-04-14 | 24-04-15->24-10-13 | rsiPeriod=7, buyThreshold=35, sellThreshold=65, atrPeriod=14 | 1.74 | -0.15 | -0.23 | 0.00 | 0.8% | 3 |
| 15 | 23-10-15->24-10-13 | 24-10-14->25-04-13 | rsiPeriod=7, buyThreshold=35, sellThreshold=65, atrPeriod=14 | 0.61 | -0.19 | -0.32 | 0.00 | 0.1% | 1 |
| 16 | 24-04-14->25-04-13 | 25-04-14->25-10-12 | rsiPeriod=7, buyThreshold=20, sellThreshold=65, atrPeriod=14 | 0.00 | -0.06 | -0.13 | 0.00 | 0.7% | 1 |
| 17 | 24-10-13->25-10-12 | 25-10-13->26-04-12 | rsiPeriod=7, buyThreshold=30, sellThreshold=70, atrPeriod=14 | 1.50 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |