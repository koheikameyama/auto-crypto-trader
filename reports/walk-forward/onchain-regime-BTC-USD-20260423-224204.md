# Walk-Forward Report: onchain-regime (BTC-USD)

**Period:** 2016-04-23 – 2026-04-23
**BTC bars:** 3651 | **Onchain bars:** 3651
**Windows:** 18
**IS/OOS/step:** 365/182/182 days
**Robustness:** FAIL
**BH Sharpe (benchmark):** 1.102 | Beats BH: NO

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | 0.684 |
| OOS Avg MAR | 4.871 |
| OOS Avg PF | 5.140 |
| OOS Max DD | 42.73% |
| OOS Avg Total Return | 12.77% |
| IS->OOS Sharpe Drop | 49.27% |

## Buy & Hold Benchmark (full period)

| Metric | Value |
|---|---|
| BH Sharpe | 1.102 |
| BH MAR | 0.806 |
| BH Total Return | 16954.25% |
| BH Max DD | 83.40% |

## Parameter Grid

```json
{
  "nvtLookback": [
    7,
    14,
    30
  ],
  "nvtPercentile": [
    0.5,
    0.7,
    0.85
  ],
  "aaLookback": [
    14,
    30,
    60
  ]
}
```

## Fixed Parameters

```json
{
  "aaMomentumThreshold": 1,
  "percentileWindow": 365
}
```

## Windows

| # | IS Period | OOS Period | Best Params | IS Sharpe | OOS Sharpe | OOS MAR | OOS PF | OOS DD | OOS Trades |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 16-04-24->17-04-23 | 17-04-24->17-10-22 | aaMomentumThreshold=1, percentileWindow=365, nvtLookback=7, nvtPercentile=0.5, aaLookback=14 | 0.00 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 1 | 16-10-23->17-10-22 | 17-10-23->18-04-22 | aaMomentumThreshold=1, percentileWindow=365, nvtLookback=7, nvtPercentile=0.5, aaLookback=14 | 0.00 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 2 | 17-04-23->18-04-22 | 18-04-23->18-10-21 | aaMomentumThreshold=1, percentileWindow=365, nvtLookback=14, nvtPercentile=0.7, aaLookback=14 | 1.44 | -0.52 | -0.94 | 0.74 | 28.1% | 33 |
| 3 | 17-10-22->18-10-21 | 18-10-22->19-04-21 | aaMomentumThreshold=1, percentileWindow=365, nvtLookback=14, nvtPercentile=0.7, aaLookback=14 | 0.36 | 0.85 | 1.16 | 1.35 | 28.1% | 29 |
| 4 | 18-04-22->19-04-21 | 19-04-22->19-10-20 | aaMomentumThreshold=1, percentileWindow=365, nvtLookback=30, nvtPercentile=0.7, aaLookback=60 | 0.95 | 3.28 | 26.45 | 9.36 | 14.1% | 10 |
| 5 | 18-10-21->19-10-20 | 19-10-21->20-04-19 | aaMomentumThreshold=1, percentileWindow=365, nvtLookback=14, nvtPercentile=0.7, aaLookback=60 | 2.77 | 1.78 | 10.05 | 2.46 | 10.2% | 22 |
| 6 | 19-04-21->20-04-19 | 20-04-20->20-10-18 | aaMomentumThreshold=1, percentileWindow=365, nvtLookback=14, nvtPercentile=0.7, aaLookback=60 | 2.73 | 2.98 | 11.44 | 12.69 | 13.6% | 7 |
| 7 | 19-10-20->20-10-18 | 20-10-19->21-04-18 | aaMomentumThreshold=1, percentileWindow=365, nvtLookback=30, nvtPercentile=0.7, aaLookback=60 | 2.65 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 8 | 20-04-19->21-04-18 | 21-04-19->21-10-17 | aaMomentumThreshold=1, percentileWindow=365, nvtLookback=30, nvtPercentile=0.7, aaLookback=14 | 2.57 | 3.08 | 22.26 | 32.83 | 4.7% | 5 |
| 9 | 20-10-18->21-10-17 | 21-10-18->22-04-17 | aaMomentumThreshold=1, percentileWindow=365, nvtLookback=30, nvtPercentile=0.85, aaLookback=60 | 2.27 | -0.41 | -0.92 | 0.77 | 23.3% | 27 |
| 10 | 21-04-18->22-04-17 | 22-04-18->22-10-16 | aaMomentumThreshold=1, percentileWindow=365, nvtLookback=30, nvtPercentile=0.85, aaLookback=30 | 1.49 | -1.74 | -1.60 | 0.50 | 37.9% | 34 |
| 11 | 21-10-17->22-10-16 | 22-10-17->23-04-16 | aaMomentumThreshold=1, percentileWindow=365, nvtLookback=7, nvtPercentile=0.7, aaLookback=30 | -0.86 | 0.13 | -0.14 | 0.96 | 26.3% | 36 |
| 12 | 22-04-17->23-04-16 | 23-04-17->23-10-15 | aaMomentumThreshold=1, percentileWindow=365, nvtLookback=7, nvtPercentile=0.5, aaLookback=60 | -0.56 | 0.47 | 0.65 | 1.15 | 11.7% | 23 |
| 13 | 22-10-16->23-10-15 | 23-10-16->24-04-14 | aaMomentumThreshold=1, percentileWindow=365, nvtLookback=14, nvtPercentile=0.7, aaLookback=60 | 0.94 | 0.94 | 1.71 | 2.51 | 7.0% | 8 |
| 14 | 23-04-16->24-04-14 | 24-04-15->24-10-13 | aaMomentumThreshold=1, percentileWindow=365, nvtLookback=14, nvtPercentile=0.85, aaLookback=60 | 1.08 | 1.12 | 3.34 | 1.41 | 11.4% | 26 |
| 15 | 23-10-15->24-10-13 | 24-10-14->25-04-13 | aaMomentumThreshold=1, percentileWindow=365, nvtLookback=30, nvtPercentile=0.7, aaLookback=60 | 1.54 | 2.75 | 15.40 | 24.31 | 4.9% | 8 |
| 16 | 24-04-14->25-04-13 | 25-04-14->25-10-12 | aaMomentumThreshold=1, percentileWindow=365, nvtLookback=30, nvtPercentile=0.7, aaLookback=60 | 2.19 | 0.33 | 0.36 | 1.18 | 11.3% | 13 |
| 17 | 24-10-13->25-10-12 | 25-10-13->26-04-12 | aaMomentumThreshold=1, percentileWindow=365, nvtLookback=7, nvtPercentile=0.5, aaLookback=30 | 2.74 | -2.71 | -1.54 | 0.28 | 42.7% | 39 |