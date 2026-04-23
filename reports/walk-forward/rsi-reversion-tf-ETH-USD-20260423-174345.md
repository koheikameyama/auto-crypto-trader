# Walk-Forward Report: rsi-reversion-tf / ETH-USD

**Period:** 2016-04-23 - 2026-04-23
**Windows:** 14
**Robustness:** FAIL
**Buy & Hold Sharpe:** 0.709 (strategy beats BH: NO)
**Failure reasons:**
- OOS Sharpe -0.138 < min 1
- IS->OOS Sharpe drop 118.65% > max 30.00%

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | -0.138 |
| OOS Avg MAR | 0.765 |
| OOS Avg PF | 9.092 |
| OOS Max DD | 1.05% |
| OOS Avg Total Return | 0.09% |
| IS->OOS Sharpe Drop | 118.65% |

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
| 0 | 17-11-09->18-11-08 | 18-11-09->19-05-09 | rsiPeriod=7, buyThreshold=20, sellThreshold=65, atrPeriod=14 | 0.29 | -1.53 | -2.01 | 0.00 | 1.0% | 2 |
| 1 | 18-05-10->19-05-09 | 19-05-10->19-11-07 | rsiPeriod=7, buyThreshold=35, sellThreshold=70, atrPeriod=14 | 0.73 | 1.05 | 2.24 | 2.08 | 1.0% | 2 |
| 2 | 18-11-08->19-11-07 | 19-11-08->20-05-07 | rsiPeriod=7, buyThreshold=35, sellThreshold=65, atrPeriod=14 | 1.66 | -0.08 | -0.18 | 0.00 | 0.3% | 2 |
| 3 | 19-05-09->20-05-07 | 20-05-08->20-11-05 | rsiPeriod=7, buyThreshold=20, sellThreshold=65, atrPeriod=14 | 1.61 | -1.89 | -2.01 | 0.00 | 1.0% | 1 |
| 4 | 19-11-07->20-11-05 | 20-11-06->21-05-06 | rsiPeriod=7, buyThreshold=30, sellThreshold=75, atrPeriod=14 | 1.47 | -0.02 | -0.06 | 0.00 | 0.3% | 1 |
| 5 | 20-05-07->21-05-06 | 21-05-07->21-11-04 | rsiPeriod=7, buyThreshold=20, sellThreshold=70, atrPeriod=14 | 0.00 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 6 | 20-11-05->21-11-04 | 21-11-05->22-05-05 | rsiPeriod=7, buyThreshold=20, sellThreshold=70, atrPeriod=14 | 0.00 | -2.46 | -2.01 | 0.00 | 1.0% | 1 |
| 7 | 21-05-06->22-05-05 | 22-05-06->22-11-03 | rsiPeriod=7, buyThreshold=35, sellThreshold=65, atrPeriod=14 | 0.30 | 2.21 | 11.70 | 48.13 | 0.4% | 3 |
| 8 | 21-11-04->22-11-03 | 22-11-04->23-05-04 | rsiPeriod=7, buyThreshold=30, sellThreshold=65, atrPeriod=14 | 1.54 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 9 | 22-05-05->23-05-04 | 23-05-05->23-11-02 | rsiPeriod=7, buyThreshold=30, sellThreshold=65, atrPeriod=14 | 1.83 | -0.10 | -0.18 | 0.00 | 0.5% | 1 |
| 10 | 22-11-03->23-11-02 | 23-11-03->24-05-02 | rsiPeriod=7, buyThreshold=35, sellThreshold=65, atrPeriod=14 | -0.13 | 0.93 | 3.29 | 77.08 | 0.8% | 2 |
| 11 | 23-05-04->24-05-02 | 24-05-03->24-10-31 | rsiPeriod=7, buyThreshold=25, sellThreshold=70, atrPeriod=14 | 0.72 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 12 | 23-11-02->24-10-31 | 24-11-01->25-05-01 | rsiPeriod=7, buyThreshold=35, sellThreshold=65, atrPeriod=14 | 0.30 | -0.04 | -0.08 | 0.00 | 0.4% | 1 |
| 13 | 24-05-02->25-05-01 | 25-05-02->25-10-30 | rsiPeriod=7, buyThreshold=20, sellThreshold=75, atrPeriod=14 | 0.00 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |