# Walk-Forward Report: ma-crossover-tf / ETH-USD

**Period:** 2016-04-23 - 2026-04-23
**Windows:** 14
**Robustness:** FAIL
**Buy & Hold Sharpe:** 0.709 (strategy beats BH: NO)
**Failure reasons:**
- OOS Sharpe -0.097 < min 1
- IS->OOS Sharpe drop 109.52% > max 30.00%

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | -0.097 |
| OOS Avg MAR | 1.899 |
| OOS Avg PF | 3.522 |
| OOS Max DD | 4.80% |
| OOS Avg Total Return | 0.30% |
| IS->OOS Sharpe Drop | 109.52% |

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
| 0 | 17-11-09->18-11-08 | 18-11-09->19-05-09 | shortEma=30, longEma=50, atrPeriod=14 | 1.42 | -0.81 | -1.09 | 0.28 | 2.7% | 3 |
| 1 | 18-05-10->19-05-09 | 19-05-10->19-11-07 | shortEma=30, longEma=100, atrPeriod=14 | 0.98 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 2 | 18-11-08->19-11-07 | 19-11-08->20-05-07 | shortEma=10, longEma=50, atrPeriod=14 | 0.38 | 0.87 | 3.51 | 3.98 | 1.9% | 3 |
| 3 | 19-05-09->20-05-07 | 20-05-08->20-11-05 | shortEma=20, longEma=50, atrPeriod=14 | 1.73 | -1.86 | -2.01 | 0.00 | 1.0% | 2 |
| 4 | 19-11-07->20-11-05 | 20-11-06->21-05-06 | shortEma=10, longEma=50, atrPeriod=14 | 0.41 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 5 | 20-05-07->21-05-06 | 21-05-07->21-11-04 | shortEma=10, longEma=100, atrPeriod=14 | 0.00 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 6 | 20-11-05->21-11-04 | 21-11-05->22-05-05 | shortEma=30, longEma=50, atrPeriod=14 | 0.32 | -1.55 | -1.46 | 0.00 | 1.4% | 2 |
| 7 | 21-05-06->22-05-05 | 22-05-06->22-11-03 | shortEma=10, longEma=50, atrPeriod=14 | 1.21 | 0.84 | 3.52 | 19.64 | 0.7% | 5 |
| 8 | 21-11-04->22-11-03 | 22-11-04->23-05-04 | shortEma=10, longEma=50, atrPeriod=14 | 1.44 | 2.54 | 18.59 | 10.00 | 0.5% | 3 |
| 9 | 22-05-05->23-05-04 | 23-05-05->23-11-02 | shortEma=10, longEma=50, atrPeriod=14 | 1.74 | -0.98 | -1.09 | 0.24 | 1.5% | 3 |
| 10 | 22-11-03->23-11-02 | 23-11-03->24-05-02 | shortEma=10, longEma=50, atrPeriod=14 | 1.54 | 1.97 | 7.84 | 5.10 | 1.1% | 3 |
| 11 | 23-05-04->24-05-02 | 24-05-03->24-10-31 | shortEma=10, longEma=50, atrPeriod=14 | 1.05 | -2.79 | -1.96 | 0.05 | 4.8% | 8 |
| 12 | 23-11-02->24-10-31 | 24-11-01->25-05-01 | shortEma=20, longEma=100, atrPeriod=14 | 1.25 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 13 | 24-05-02->25-05-01 | 25-05-02->25-10-30 | shortEma=20, longEma=50, atrPeriod=14 | 0.73 | 0.42 | 0.74 | 10.00 | 0.4% | 1 |