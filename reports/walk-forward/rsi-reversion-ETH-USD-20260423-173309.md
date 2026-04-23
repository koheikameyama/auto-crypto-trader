# Walk-Forward Report: rsi-reversion / ETH-USD

**Period:** 2016-04-23 - 2026-04-23
**Windows:** 14
**Robustness:** FAIL
**Buy & Hold Sharpe:** 0.709 (strategy beats BH: NO)
**Failure reasons:**
- OOS Sharpe 0.667 < min 1
- IS->OOS Sharpe drop 53.75% > max 30.00%

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | 0.667 |
| OOS Avg MAR | 3.057 |
| OOS Avg PF | 9.330 |
| OOS Max DD | 3.59% |
| OOS Avg Total Return | 1.64% |
| IS->OOS Sharpe Drop | 53.75% |

## Buy & Hold Benchmark

| Metric | Value |
|---|---|
| BH Sharpe | 0.709 |
| BH MAR | 0.285 |
| BH Total Return | 640.48% |
| BH Annualized | 26.74% |
| BH Max DD | 93.96% |

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
| 0 | 17-11-09->18-11-08 | 18-11-09->19-05-09 | rsiPeriod=14, buyThreshold=35, sellThreshold=75, atrPeriod=14 | 1.20 | -2.38 | -1.71 | 0.00 | 3.6% | 5 |
| 1 | 18-05-10->19-05-09 | 19-05-10->19-11-07 | rsiPeriod=7, buyThreshold=35, sellThreshold=70, atrPeriod=14 | 1.44 | 1.34 | 3.64 | 2.05 | 1.7% | 16 |
| 2 | 18-11-08->19-11-07 | 19-11-08->20-05-07 | rsiPeriod=14, buyThreshold=30, sellThreshold=70, atrPeriod=14 | 0.86 | -1.46 | -2.00 | 0.00 | 2.1% | 6 |
| 3 | 19-05-09->20-05-07 | 20-05-08->20-11-05 | rsiPeriod=14, buyThreshold=20, sellThreshold=70, atrPeriod=14 | 1.16 | 1.57 | 6.02 | 5.09 | 1.5% | 3 |
| 4 | 19-11-07->20-11-05 | 20-11-06->21-05-06 | rsiPeriod=14, buyThreshold=20, sellThreshold=65, atrPeriod=14 | 1.94 | -0.65 | -1.22 | 0.51 | 2.6% | 13 |
| 5 | 20-05-07->21-05-06 | 21-05-07->21-11-04 | rsiPeriod=21, buyThreshold=20, sellThreshold=70, atrPeriod=14 | 0.82 | -0.04 | -0.09 | 0.00 | 0.8% | 2 |
| 6 | 20-11-05->21-11-04 | 21-11-05->22-05-05 | rsiPeriod=21, buyThreshold=20, sellThreshold=70, atrPeriod=14 | 1.28 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 7 | 21-05-06->22-05-05 | 22-05-06->22-11-03 | rsiPeriod=7, buyThreshold=25, sellThreshold=75, atrPeriod=14 | 0.73 | 0.36 | 0.68 | 1.32 | 2.0% | 9 |
| 8 | 21-11-04->22-11-03 | 22-11-04->23-05-04 | rsiPeriod=21, buyThreshold=30, sellThreshold=70, atrPeriod=14 | 1.00 | 1.10 | 3.52 | 49.15 | 1.1% | 3 |
| 9 | 22-05-05->23-05-04 | 23-05-05->23-11-02 | rsiPeriod=7, buyThreshold=25, sellThreshold=65, atrPeriod=14 | 1.76 | 2.69 | 9.45 | 20.61 | 1.1% | 10 |
| 10 | 22-11-03->23-11-02 | 23-11-03->24-05-02 | rsiPeriod=7, buyThreshold=25, sellThreshold=65, atrPeriod=14 | 1.77 | 2.75 | 15.67 | 44.87 | 0.8% | 8 |
| 11 | 23-05-04->24-05-02 | 24-05-03->24-10-31 | rsiPeriod=7, buyThreshold=25, sellThreshold=65, atrPeriod=14 | 2.66 | 1.20 | 2.35 | 1.93 | 2.1% | 11 |
| 12 | 23-11-02->24-10-31 | 24-11-01->25-05-01 | rsiPeriod=7, buyThreshold=25, sellThreshold=65, atrPeriod=14 | 1.98 | 1.15 | 2.11 | 2.77 | 2.1% | 14 |
| 13 | 24-05-02->25-05-01 | 25-05-02->25-10-30 | rsiPeriod=7, buyThreshold=35, sellThreshold=65, atrPeriod=14 | 1.57 | 1.70 | 4.37 | 2.33 | 2.1% | 16 |