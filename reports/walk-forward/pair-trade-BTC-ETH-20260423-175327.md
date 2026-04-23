# Walk-Forward Report: pair-trade (BTC-USD / ETH-USD)

**Period:** 2016-04-23 – 2026-04-23
**Aligned bars:** 3087
**Windows:** 14
**IS/OOS/step:** 365/182/182 days

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | -0.693 |
| OOS Avg MAR | 0.241 |
| OOS Avg PF | 2.547 |
| OOS Max DD | 34.03% |
| OOS Avg Total Return | -8.93% |
| IS->OOS Sharpe Drop | 178.66% |

## Parameter Grid

```json
{
  "lookback": [
    20,
    30,
    60
  ],
  "entryThreshold": [
    1.5,
    2,
    2.5
  ],
  "exitThreshold": [
    0,
    0.5,
    1
  ]
}
```

## Fixed Parameters

```json
{
  "stopThreshold": 3.5,
  "timeStopDays": 30
}
```

## Windows

| # | IS Period | OOS Period | Best Params | IS Sharpe | OOS Sharpe | OOS MAR | OOS PF | OOS DD | OOS Trades |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 17-11-09->18-11-08 | 18-11-09->19-05-09 | stopThreshold=3.5, timeStopDays=30, lookback=30, entryThreshold=2.5, exitThreshold=0 | 1.20 | -0.36 | -0.65 | 0.39 | 12.5% | 3 |
| 1 | 18-05-10->19-05-09 | 19-05-10->19-11-07 | stopThreshold=3.5, timeStopDays=30, lookback=30, entryThreshold=1.5, exitThreshold=0 | 0.05 | -2.58 | -1.57 | 0.06 | 34.0% | 6 |
| 2 | 18-11-08->19-11-07 | 19-11-08->20-05-07 | stopThreshold=3.5, timeStopDays=30, lookback=20, entryThreshold=2.5, exitThreshold=0.5 | 0.66 | -2.72 | -1.70 | 0.00 | 30.0% | 6 |
| 3 | 19-05-09->20-05-07 | 20-05-08->20-11-05 | stopThreshold=3.5, timeStopDays=30, lookback=30, entryThreshold=2.5, exitThreshold=1 | -0.26 | -1.88 | -1.81 | 0.24 | 18.7% | 6 |
| 4 | 19-11-07->20-11-05 | 20-11-06->21-05-06 | stopThreshold=3.5, timeStopDays=30, lookback=60, entryThreshold=1.5, exitThreshold=0 | -0.02 | -1.71 | -1.55 | 0.39 | 33.0% | 3 |
| 5 | 20-05-07->21-05-06 | 21-05-07->21-11-04 | stopThreshold=3.5, timeStopDays=30, lookback=60, entryThreshold=2.5, exitThreshold=0 | 0.79 | 1.78 | 6.72 | 10.00 | 1.8% | 1 |
| 6 | 20-11-05->21-11-04 | 21-11-05->22-05-05 | stopThreshold=3.5, timeStopDays=30, lookback=20, entryThreshold=1.5, exitThreshold=0 | 0.83 | -0.66 | -0.99 | 0.32 | 11.1% | 5 |
| 7 | 21-05-06->22-05-05 | 22-05-06->22-11-03 | stopThreshold=3.5, timeStopDays=30, lookback=60, entryThreshold=2, exitThreshold=1 | 1.66 | -1.10 | -1.03 | 0.04 | 11.6% | 2 |
| 8 | 21-11-04->22-11-03 | 22-11-04->23-05-04 | stopThreshold=3.5, timeStopDays=30, lookback=20, entryThreshold=1.5, exitThreshold=0.5 | 0.71 | 2.10 | 5.96 | 8.16 | 3.1% | 8 |
| 9 | 22-05-05->23-05-04 | 23-05-05->23-11-02 | stopThreshold=3.5, timeStopDays=30, lookback=20, entryThreshold=1.5, exitThreshold=0.5 | 1.83 | -0.55 | -0.49 | 0.77 | 9.4% | 8 |
| 10 | 22-11-03->23-11-02 | 23-11-03->24-05-02 | stopThreshold=3.5, timeStopDays=30, lookback=30, entryThreshold=2, exitThreshold=0 | 1.27 | 1.47 | 3.65 | 14.33 | 6.6% | 4 |
| 11 | 23-05-04->24-05-02 | 24-05-03->24-10-31 | stopThreshold=3.5, timeStopDays=30, lookback=20, entryThreshold=2, exitThreshold=0 | 1.33 | -2.20 | -1.70 | 0.00 | 17.5% | 5 |
| 12 | 23-11-02->24-10-31 | 24-11-01->25-05-01 | stopThreshold=3.5, timeStopDays=30, lookback=30, entryThreshold=2.5, exitThreshold=1 | 2.20 | -1.19 | -1.27 | 0.09 | 9.7% | 3 |
| 13 | 24-05-02->25-05-01 | 25-05-02->25-10-30 | stopThreshold=3.5, timeStopDays=30, lookback=30, entryThreshold=2.5, exitThreshold=1 | 0.08 | -0.10 | -0.17 | 0.88 | 11.1% | 4 |