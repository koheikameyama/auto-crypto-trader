# Backtest Report: rsi-reversion / BTC-USD

**Period:** 2016-04-23 – 2026-04-23
**Initial Capital:** $10,000.00

## KPIs

| Metric | Value |
|---|---|
| Sharpe | -0.343 |
| MAR | -0.085 |
| Profit Factor | 0.690 |
| Max Drawdown | 15.38% |
| Total Return | -12.36% |
| Win Rate | 14.81% |
| Trades | 135 |
| Expectancy | -$9.16 |

## Parameters

```json
{
  "rsiPeriod": 14,
  "buyThreshold": 30,
  "sellThreshold": 70,
  "atrPeriod": 14
}
```

## Trades Summary

- **Total Trades:** 135
- **Winners:** 20
- **Losers:** 115
- **Largest Win:** $352.66
- **Largest Loss:** -$111.83
- **Avg Holding Days:** 2.42

## Exit Reason Breakdown

| Reason | Count |
|---|---|
| sl | 39 |
| trailing | 76 |
| time | 20 |
| signal | 0 |
| end_of_data | 0 |

## Equity Curve (sampled)

- Start: 2016-04-24 $10,000.00
- Max: 2016-10-19 $10,269.75
- Min: 2026-02-01 $8,690.26
- End: 2026-04-22 $8,763.79
