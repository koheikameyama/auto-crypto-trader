# Walk-Forward Report: Multi-Signal Regime (BTC-USD)

**Period:** 2016-04-23 – 2026-04-23
**Signals:** Onchain (NVT + AA momentum) + DXY SMA + VIX threshold
**Windows:** 18
**IS/OOS/step:** 365/182/182
**Robustness:** FAIL
**BH Sharpe:** 1.102 | Beats BH: NO

## Aggregate OOS KPIs

| Metric | Value |
|---|---|
| OOS Avg Sharpe | -0.048 |
| OOS Avg MAR | 0.086 |
| OOS Avg PF | 0.149 |
| OOS Max DD | 12.01% |
| OOS Avg Total Return | -0.29% |
| IS->OOS Sharpe Drop | 104.44% |

## BH Benchmark (full 10y)

| Metric | Value |
|---|---|
| BH Sharpe | 1.102 |
| BH MAR | 0.806 |
| BH Total Return | 16954.25% |
| BH Max DD | 83.40% |

## Parameter Grid

```json
{
  "nvtPercentile": [
    0.5,
    0.7,
    0.85
  ],
  "aaLookback": [
    14,
    30,
    60
  ],
  "dxySmaPeriod": [
    100,
    200
  ],
  "vixThreshold": [
    25,
    30,
    35
  ]
}
```

## Fixed Parameters

```json
{
  "nvtLookback": 14,
  "aaMomentumThreshold": 1,
  "percentileWindow": 365
}
```

## Windows

| # | IS Period | OOS Period | Best Params | IS Sharpe | OOS Sharpe | OOS MAR | OOS PF | OOS DD | OOS Trades |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 16-04-24->17-04-23 | 17-04-24->17-10-22 | nvtLookback=14, aaMomentumThreshold=1, percentileWindow=365, nvtPercentile=0.5, aaLookback=14, dxySmaPeriod=100, vixThreshold=25 | 0.00 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 1 | 16-10-23->17-10-22 | 17-10-23->18-04-22 | nvtLookback=14, aaMomentumThreshold=1, percentileWindow=365, nvtPercentile=0.5, aaLookback=14, dxySmaPeriod=100, vixThreshold=25 | 0.00 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 2 | 17-04-23->18-04-22 | 18-04-23->18-10-21 | nvtLookback=14, aaMomentumThreshold=1, percentileWindow=365, nvtPercentile=0.7, aaLookback=14, dxySmaPeriod=200, vixThreshold=25 | 1.44 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 3 | 17-10-22->18-10-21 | 18-10-22->19-04-21 | nvtLookback=14, aaMomentumThreshold=1, percentileWindow=365, nvtPercentile=0.85, aaLookback=30, dxySmaPeriod=100, vixThreshold=25 | 1.62 | -0.82 | -1.03 | 0.48 | 4.0% | 5 |
| 4 | 18-04-22->19-04-21 | 19-04-22->19-10-20 | nvtLookback=14, aaMomentumThreshold=1, percentileWindow=365, nvtPercentile=0.5, aaLookback=30, dxySmaPeriod=100, vixThreshold=30 | -0.30 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 5 | 18-10-21->19-10-20 | 19-10-21->20-04-19 | nvtLookback=14, aaMomentumThreshold=1, percentileWindow=365, nvtPercentile=0.7, aaLookback=60, dxySmaPeriod=100, vixThreshold=25 | 2.27 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 6 | 19-04-21->20-04-19 | 20-04-20->20-10-18 | nvtLookback=14, aaMomentumThreshold=1, percentileWindow=365, nvtPercentile=0.7, aaLookback=14, dxySmaPeriod=100, vixThreshold=35 | 1.18 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 7 | 19-10-20->20-10-18 | 20-10-19->21-04-18 | nvtLookback=14, aaMomentumThreshold=1, percentileWindow=365, nvtPercentile=0.85, aaLookback=30, dxySmaPeriod=200, vixThreshold=25 | 1.77 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 8 | 20-04-19->21-04-18 | 21-04-19->21-10-17 | nvtLookback=14, aaMomentumThreshold=1, percentileWindow=365, nvtPercentile=0.85, aaLookback=30, dxySmaPeriod=100, vixThreshold=25 | 1.11 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 9 | 20-10-18->21-10-17 | 21-10-18->22-04-17 | nvtLookback=14, aaMomentumThreshold=1, percentileWindow=365, nvtPercentile=0.85, aaLookback=30, dxySmaPeriod=200, vixThreshold=25 | 1.24 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 10 | 21-04-18->22-04-17 | 22-04-18->22-10-16 | nvtLookback=14, aaMomentumThreshold=1, percentileWindow=365, nvtPercentile=0.5, aaLookback=14, dxySmaPeriod=100, vixThreshold=25 | 0.66 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 11 | 21-10-17->22-10-16 | 22-10-17->23-04-16 | nvtLookback=14, aaMomentumThreshold=1, percentileWindow=365, nvtPercentile=0.5, aaLookback=14, dxySmaPeriod=100, vixThreshold=25 | 0.83 | -1.42 | -1.45 | 0.17 | 12.0% | 7 |
| 12 | 22-04-17->23-04-16 | 23-04-17->23-10-15 | nvtLookback=14, aaMomentumThreshold=1, percentileWindow=365, nvtPercentile=0.7, aaLookback=60, dxySmaPeriod=200, vixThreshold=30 | 1.44 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 13 | 22-10-16->23-10-15 | 23-10-16->24-04-14 | nvtLookback=14, aaMomentumThreshold=1, percentileWindow=365, nvtPercentile=0.7, aaLookback=60, dxySmaPeriod=200, vixThreshold=25 | 1.83 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 14 | 23-04-16->24-04-14 | 24-04-15->24-10-13 | nvtLookback=14, aaMomentumThreshold=1, percentileWindow=365, nvtPercentile=0.85, aaLookback=60, dxySmaPeriod=200, vixThreshold=25 | 1.24 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 15 | 23-10-15->24-10-13 | 24-10-14->25-04-13 | nvtLookback=14, aaMomentumThreshold=1, percentileWindow=365, nvtPercentile=0.7, aaLookback=60, dxySmaPeriod=200, vixThreshold=30 | 1.29 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |
| 16 | 24-04-14->25-04-13 | 25-04-14->25-10-12 | nvtLookback=14, aaMomentumThreshold=1, percentileWindow=365, nvtPercentile=0.7, aaLookback=60, dxySmaPeriod=100, vixThreshold=30 | 0.49 | 1.38 | 4.04 | 2.03 | 3.0% | 11 |
| 17 | 24-10-13->25-10-12 | 25-10-13->26-04-12 | nvtLookback=14, aaMomentumThreshold=1, percentileWindow=365, nvtPercentile=0.5, aaLookback=60, dxySmaPeriod=200, vixThreshold=25 | 1.37 | 0.00 | 0.00 | 0.00 | 0.0% | 0 |