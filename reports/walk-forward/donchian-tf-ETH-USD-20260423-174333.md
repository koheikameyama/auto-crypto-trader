# Walk-Forward Report: donchian-tf / ETH-USD

**Period:** 2016-04-23 - 2026-04-23
**Windows:** 14
**Robustness:** FAIL
**Buy & Hold Sharpe:** 0.709 (strategy beats BH: YES)
**Failure reasons:**
- OOS Sharpe 0.808 < min 1
- IS->OOS Sharpe drop 44.89% > max 30.00%

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | 0.808 |
| OOS Avg MAR | 2.672 |
| OOS Avg PF | 2.061 |
| OOS Max DD | 3.84% |
| OOS Avg Total Return | 3.13% |
| IS->OOS Sharpe Drop | 44.89% |

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
| 0 | 17-11-09->18-11-08 | 18-11-09->19-05-09 | entryPeriod=55, exitPeriod=10, atrPeriod=14 | 1.59 | -0.04 | -0.08 | 0.00 | 0.6% | 1 |
| 1 | 18-05-10->19-05-09 | 19-05-10->19-11-07 | entryPeriod=55, exitPeriod=10, atrPeriod=14 | 2.48 | -1.49 | -1.75 | 0.00 | 1.2% | 4 |
| 2 | 18-11-08->19-11-07 | 19-11-08->20-05-07 | entryPeriod=20, exitPeriod=10, atrPeriod=14 | 0.92 | 0.48 | 0.92 | 1.29 | 3.3% | 12 |
| 3 | 19-05-09->20-05-07 | 20-05-08->20-11-05 | entryPeriod=10, exitPeriod=10, atrPeriod=14 | 1.46 | 2.33 | 8.05 | 4.10 | 2.8% | 12 |
| 4 | 19-11-07->20-11-05 | 20-11-06->21-05-06 | entryPeriod=10, exitPeriod=10, atrPeriod=14 | 1.36 | 2.21 | 12.60 | 6.11 | 1.9% | 13 |
| 5 | 20-05-07->21-05-06 | 21-05-07->21-11-04 | entryPeriod=10, exitPeriod=10, atrPeriod=14 | 2.35 | 0.51 | 1.39 | 1.39 | 1.9% | 14 |
| 6 | 20-11-05->21-11-04 | 21-11-05->22-05-05 | entryPeriod=10, exitPeriod=10, atrPeriod=14 | 1.42 | -0.46 | -0.66 | 0.83 | 3.2% | 11 |
| 7 | 21-05-06->22-05-05 | 22-05-06->22-11-03 | entryPeriod=30, exitPeriod=10, atrPeriod=14 | -0.22 | 0.16 | 0.27 | 1.11 | 2.7% | 8 |
| 8 | 21-11-04->22-11-03 | 22-11-04->23-05-04 | entryPeriod=30, exitPeriod=10, atrPeriod=14 | 1.03 | 1.10 | 2.08 | 2.39 | 3.0% | 7 |
| 9 | 22-05-05->23-05-04 | 23-05-05->23-11-02 | entryPeriod=10, exitPeriod=10, atrPeriod=14 | 1.67 | 1.88 | 5.45 | 3.49 | 2.0% | 8 |
| 10 | 22-11-03->23-11-02 | 23-11-03->24-05-02 | entryPeriod=10, exitPeriod=10, atrPeriod=14 | 2.08 | 1.07 | 1.66 | 1.70 | 3.8% | 12 |
| 11 | 23-05-04->24-05-02 | 24-05-03->24-10-31 | entryPeriod=10, exitPeriod=10, atrPeriod=14 | 1.68 | 1.29 | 3.31 | 2.53 | 2.2% | 13 |
| 12 | 23-11-02->24-10-31 | 24-11-01->25-05-01 | entryPeriod=10, exitPeriod=10, atrPeriod=14 | 1.15 | 1.04 | 2.23 | 2.10 | 2.1% | 7 |
| 13 | 24-05-02->25-05-01 | 25-05-02->25-10-30 | entryPeriod=20, exitPeriod=10, atrPeriod=14 | 1.57 | 1.24 | 1.93 | 1.83 | 3.8% | 10 |