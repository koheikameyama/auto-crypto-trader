# Backtest Report: rsi-reversion / ETH-USD

**Period:** 2016-04-23 – 2026-04-23
**Initial Capital:** $10,000.00

## KPIs

| Metric | Value |
|---|---|
| Sharpe | -0.058 |
| MAR | -0.031 |
| Profit Factor | 0.918 |
| Max Drawdown | 9.68% |
| Total Return | -2.49% |
| Win Rate | 12.50% |
| Trades | 96 |
| Expectancy | -$2.59 |

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

- **Total Trades:** 96
- **Winners:** 12
- **Losers:** 84
- **Largest Win:** $563.04
- **Largest Loss:** -$108.44
- **Avg Holding Days:** 2.24

## Exit Reason Breakdown

| Reason | Count |
|---|---|
| sl | 29 |
| trailing | 55 |
| time | 12 |
| signal | 0 |
| end_of_data | 0 |

## Equity Curve (sampled)

- Start: 2017-11-09 $10,000.00
- Max: 2023-09-15 $10,463.70
- Min: 2019-05-27 $9,031.99
- End: 2026-04-22 $9,750.91
