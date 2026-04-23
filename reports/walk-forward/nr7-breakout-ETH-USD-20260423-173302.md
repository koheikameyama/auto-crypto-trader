# Walk-Forward Report: nr7-breakout / ETH-USD

**Period:** 2016-04-23 - 2026-04-23
**Windows:** 14
**Robustness:** FAIL
**Buy & Hold Sharpe:** 0.709 (strategy beats BH: NO)
**Failure reasons:**
- OOS Sharpe 0.043 < min 1
- IS->OOS Sharpe drop 92.00% > max 30.00%

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | 0.043 |
| OOS Avg MAR | 1.400 |
| OOS Avg PF | 1.566 |
| OOS Max DD | 6.93% |
| OOS Avg Total Return | 0.88% |
| IS->OOS Sharpe Drop | 92.00% |

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
| 0 | 17-11-09->18-11-08 | 18-11-09->19-05-09 | lookback=7, atrPeriod=14 | 1.74 | 0.01 | -0.03 | 0.99 | 2.7% | 12 |
| 1 | 18-05-10->19-05-09 | 19-05-10->19-11-07 | lookback=7, atrPeriod=14 | 1.54 | 0.72 | 1.34 | 1.33 | 3.5% | 19 |
| 2 | 18-11-08->19-11-07 | 19-11-08->20-05-07 | lookback=5, atrPeriod=14 | 0.93 | -0.51 | -1.11 | 0.75 | 4.8% | 21 |
| 3 | 19-05-09->20-05-07 | 20-05-08->20-11-05 | lookback=10, atrPeriod=14 | 0.53 | -0.19 | -0.30 | 0.86 | 4.0% | 12 |
| 4 | 19-11-07->20-11-05 | 20-11-06->21-05-06 | lookback=7, atrPeriod=14 | -0.09 | 1.15 | 1.52 | 1.97 | 5.4% | 14 |
| 5 | 20-05-07->21-05-06 | 21-05-07->21-11-04 | lookback=7, atrPeriod=14 | 0.69 | -1.26 | -1.56 | 0.41 | 3.5% | 13 |
| 6 | 20-11-05->21-11-04 | 21-11-05->22-05-05 | lookback=10, atrPeriod=14 | 0.02 | -2.72 | -1.61 | 0.17 | 6.2% | 12 |
| 7 | 21-05-06->22-05-05 | 22-05-06->22-11-03 | lookback=10, atrPeriod=14 | -1.87 | 1.95 | 5.61 | 2.60 | 2.7% | 14 |
| 8 | 21-11-04->22-11-03 | 22-11-04->23-05-04 | lookback=10, atrPeriod=14 | 0.52 | -0.18 | -0.31 | 0.89 | 3.3% | 8 |
| 9 | 22-05-05->23-05-04 | 23-05-05->23-11-02 | lookback=10, atrPeriod=14 | 1.27 | 1.91 | 8.06 | 3.68 | 2.3% | 9 |
| 10 | 22-11-03->23-11-02 | 23-11-03->24-05-02 | lookback=10, atrPeriod=14 | 1.11 | 1.52 | 3.85 | 4.51 | 2.1% | 8 |
| 11 | 23-05-04->24-05-02 | 24-05-03->24-10-31 | lookback=5, atrPeriod=14 | 1.62 | -2.26 | -1.77 | 0.31 | 6.9% | 20 |
| 12 | 23-11-02->24-10-31 | 24-11-01->25-05-01 | lookback=10, atrPeriod=14 | 0.33 | -1.87 | -1.72 | 0.22 | 3.7% | 11 |
| 13 | 24-05-02->25-05-01 | 25-05-02->25-10-30 | lookback=7, atrPeriod=14 | -0.87 | 2.33 | 7.64 | 3.23 | 2.0% | 11 |