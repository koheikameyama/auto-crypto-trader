# Walk-Forward Report: nr7-breakout-tf / ETH-USD

**Period:** 2016-04-23 - 2026-04-23
**Windows:** 14
**Robustness:** FAIL
**Buy & Hold Sharpe:** 0.709 (strategy beats BH: NO)
**Failure reasons:**
- OOS Sharpe 0.020 < min 1
- IS->OOS Sharpe drop 94.89% > max 30.00%

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | 0.020 |
| OOS Avg MAR | 2.280 |
| OOS Avg PF | 4.889 |
| OOS Max DD | 5.34% |
| OOS Avg Total Return | 0.78% |
| IS->OOS Sharpe Drop | 94.89% |

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
  "lookback": [
    5,
    7,
    10
  ],
  "atrPeriod": [
    14
  ]
}
```

## Windows

| # | IS Period | OOS Period | Best Params | IS Sharpe | OOS Sharpe | OOS MAR | OOS PF | OOS DD | OOS Trades |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 17-11-09->18-11-08 | 18-11-09->19-05-09 | lookback=7, atrPeriod=14 | 1.62 | 0.02 | 0.00 | 1.00 | 2.1% | 5 |
| 1 | 18-05-10->19-05-09 | 19-05-10->19-11-07 | lookback=7, atrPeriod=14 | 1.40 | -0.77 | -0.92 | 0.64 | 3.8% | 11 |
| 2 | 18-11-08->19-11-07 | 19-11-08->20-05-07 | lookback=7, atrPeriod=14 | 0.56 | -2.27 | -1.98 | 0.09 | 3.7% | 7 |
| 3 | 19-05-09->20-05-07 | 20-05-08->20-11-05 | lookback=5, atrPeriod=14 | -0.34 | -0.51 | -1.00 | 0.79 | 4.2% | 14 |
| 4 | 19-11-07->20-11-05 | 20-11-06->21-05-06 | lookback=5, atrPeriod=14 | -0.53 | 2.10 | 4.23 | 4.39 | 3.5% | 11 |
| 5 | 20-05-07->21-05-06 | 21-05-07->21-11-04 | lookback=7, atrPeriod=14 | 0.82 | 1.42 | 3.41 | 36.63 | 0.7% | 4 |
| 6 | 20-11-05->21-11-04 | 21-11-05->22-05-05 | lookback=7, atrPeriod=14 | 1.34 | -2.86 | -1.76 | 0.06 | 5.3% | 9 |
| 7 | 21-05-06->22-05-05 | 22-05-06->22-11-03 | lookback=10, atrPeriod=14 | -0.93 | -0.88 | -0.69 | 0.57 | 3.9% | 6 |
| 8 | 21-11-04->22-11-03 | 22-11-04->23-05-04 | lookback=10, atrPeriod=14 | -0.07 | 1.60 | 4.24 | 3.88 | 1.5% | 2 |
| 9 | 22-05-05->23-05-04 | 23-05-05->23-11-02 | lookback=10, atrPeriod=14 | -0.03 | 2.23 | 12.86 | 9.19 | 1.6% | 4 |
| 10 | 22-11-03->23-11-02 | 23-11-03->24-05-02 | lookback=10, atrPeriod=14 | 1.55 | 0.99 | 2.69 | 3.12 | 1.7% | 5 |
| 11 | 23-05-04->24-05-02 | 24-05-03->24-10-31 | lookback=5, atrPeriod=14 | 1.71 | -1.39 | -1.49 | 0.34 | 3.6% | 9 |
| 12 | 23-11-02->24-10-31 | 24-11-01->25-05-01 | lookback=10, atrPeriod=14 | -0.13 | -2.27 | -1.62 | 0.09 | 3.5% | 7 |
| 13 | 24-05-02->25-05-01 | 25-05-02->25-10-30 | lookback=7, atrPeriod=14 | -1.58 | 2.87 | 13.95 | 7.66 | 1.1% | 4 |