# Walk-Forward Report: rsi-reversion / BTC-USD

**Period:** 2016-04-23 - 2026-04-23
**Windows:** 18
**Robustness:** FAIL
**Buy & Hold Sharpe:** 1.102 (strategy beats BH: NO)
**Failure reasons:**
- OOS Sharpe -0.164 < min 1
- OOS MAR 0.417 < min 0.5
- OOS PF 1.231 < min 1.3
- IS->OOS Sharpe drop 113.54% > max 30.00%

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | -0.164 |
| OOS Avg MAR | 0.417 |
| OOS Avg PF | 1.231 |
| OOS Max DD | 6.88% |
| OOS Avg Total Return | 0.06% |
| IS->OOS Sharpe Drop | 113.54% |

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
| 0 | 16-04-24->17-04-23 | 17-04-24->17-10-22 | rsiPeriod=21, buyThreshold=35, sellThreshold=65, atrPeriod=14 | 0.93 | 0.83 | 1.71 | 2.13 | 2.9% | 6 |
| 1 | 16-10-23->17-10-22 | 17-10-23->18-04-22 | rsiPeriod=21, buyThreshold=35, sellThreshold=80, atrPeriod=14 | 0.52 | 0.29 | 0.51 | 1.26 | 1.0% | 2 |
| 2 | 17-04-23->18-04-22 | 18-04-23->18-10-21 | rsiPeriod=21, buyThreshold=35, sellThreshold=75, atrPeriod=14 | 0.64 | 0.85 | 1.66 | 2.12 | 1.5% | 4 |
| 3 | 17-10-22->18-10-21 | 18-10-22->19-04-21 | rsiPeriod=7, buyThreshold=20, sellThreshold=75, atrPeriod=14 | 1.95 | -0.97 | -1.47 | 0.48 | 2.3% | 6 |
| 4 | 18-04-22->19-04-21 | 19-04-22->19-10-20 | rsiPeriod=7, buyThreshold=20, sellThreshold=75, atrPeriod=14 | 1.24 | -1.14 | -1.20 | 0.33 | 3.5% | 8 |
| 5 | 18-10-21->19-10-20 | 19-10-21->20-04-19 | rsiPeriod=7, buyThreshold=20, sellThreshold=65, atrPeriod=14 | 0.93 | 0.74 | 1.30 | 1.47 | 3.2% | 12 |
| 6 | 19-04-21->20-04-19 | 20-04-20->20-10-18 | rsiPeriod=7, buyThreshold=20, sellThreshold=65, atrPeriod=14 | 1.13 | 1.27 | 4.10 | 3.06 | 2.5% | 11 |
| 7 | 19-10-20->20-10-18 | 20-10-19->21-04-18 | rsiPeriod=7, buyThreshold=35, sellThreshold=70, atrPeriod=14 | 1.62 | 0.31 | 0.52 | 1.32 | 2.8% | 15 |
| 8 | 20-04-19->21-04-18 | 21-04-19->21-10-17 | rsiPeriod=7, buyThreshold=30, sellThreshold=65, atrPeriod=14 | 1.11 | -2.00 | -1.55 | 0.00 | 4.1% | 13 |
| 9 | 20-10-18->21-10-17 | 21-10-18->22-04-17 | rsiPeriod=14, buyThreshold=35, sellThreshold=80, atrPeriod=14 | 1.56 | -1.77 | -1.68 | 0.00 | 2.5% | 7 |
| 10 | 21-04-18->22-04-17 | 22-04-18->22-10-16 | rsiPeriod=7, buyThreshold=25, sellThreshold=65, atrPeriod=14 | 1.29 | 0.45 | 0.67 | 1.33 | 3.2% | 13 |
| 11 | 21-10-17->22-10-16 | 22-10-17->23-04-16 | rsiPeriod=7, buyThreshold=30, sellThreshold=70, atrPeriod=14 | 1.16 | -2.85 | -1.74 | 0.15 | 6.9% | 14 |
| 12 | 22-04-17->23-04-16 | 23-04-17->23-10-15 | rsiPeriod=21, buyThreshold=35, sellThreshold=65, atrPeriod=14 | 1.37 | 0.94 | 1.81 | 2.03 | 1.2% | 3 |
| 13 | 22-10-16->23-10-15 | 23-10-16->24-04-14 | rsiPeriod=7, buyThreshold=35, sellThreshold=65, atrPeriod=14 | 1.82 | 0.70 | 1.72 | 2.51 | 2.3% | 14 |
| 14 | 23-04-16->24-04-14 | 24-04-15->24-10-13 | rsiPeriod=7, buyThreshold=35, sellThreshold=65, atrPeriod=14 | 1.87 | -0.89 | -1.48 | 0.47 | 2.5% | 21 |
| 15 | 23-10-15->24-10-13 | 24-10-14->25-04-13 | rsiPeriod=14, buyThreshold=30, sellThreshold=65, atrPeriod=14 | 0.83 | -1.37 | -1.45 | 0.00 | 1.6% | 6 |
| 16 | 24-04-14->25-04-13 | 25-04-14->25-10-12 | rsiPeriod=7, buyThreshold=25, sellThreshold=75, atrPeriod=14 | 0.88 | 0.95 | 2.80 | 1.86 | 1.5% | 10 |
| 17 | 24-10-13->25-10-12 | 25-10-13->26-04-12 | rsiPeriod=7, buyThreshold=30, sellThreshold=75, atrPeriod=14 | 0.96 | 0.70 | 1.28 | 1.65 | 2.4% | 12 |