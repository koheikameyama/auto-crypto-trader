# Architecture

## 全体フロー

```
cron-job.org (10:05 JST)  # 09:05→10:05 へ移動: GMO 朝メンテ窓回避（2026-05-10）
  └─ workflow_dispatch → GitHub Actions
       └─ daily-live-run.yml
            ├─ Prisma migrate deploy
            ├─ yfinance-service (Python sidecar) 起動
            ├─ live-rebalance.ts (BTC + ETH virtual)
            ├─ live-execute.ts (BTC actual, EXECUTION_ENABLED=true 時のみ)
            ├─ Slack 通知
            └─ Healthchecks.io ping

cron-job.org (09:35 JST)
  └─ daily-data-collection.yml
       └─ VIX / TNX / GC / CL / on-chain / BTC.D / FGI 更新
```

## 主要コンポーネント

| ファイル | 役割 |
|---|---|
| [src/live/signal-computer.ts](../../src/live/signal-computer.ts) | Scheme E target_position 計算 |
| [src/live/portfolio-simulator.ts](../../src/live/portfolio-simulator.ts) | Virtual portfolio 日次 rebalance |
| [src/live/execution-adapter.ts](../../src/live/execution-adapter.ts) | GMO 実発注（maker LIMIT → MARKET fallback） |
| [src/live/gmo-client.ts](../../src/live/gmo-client.ts) | GMO Coin REST + HMAC-SHA256 |
| [src/live/kill-switch.ts](../../src/live/kill-switch.ts) | 連続失敗 / DD / API エラー監視 |
| [src/data/price-loader.ts](../../src/data/price-loader.ts) | Binance public klines（BTC/ETH 日足） |
| [src/data/macro-loader.ts](../../src/data/macro-loader.ts) | yfinance 経由 DXY/VIX/TNX 等 |
| [src/data/funding-loader.ts](../../src/data/funding-loader.ts) | Binance funding rate |
| [src/data/onchain-loader.ts](../../src/data/onchain-loader.ts) | CoinMetrics on-chain |

## Prisma モデル

- `Asset`: BTC-USD / ETH-USD のメタ
- `DailyBar`: 日足 OHLCV
- `MacroBar`: scalar 時系列（DXY, VIX, TNX, BTC.D, FGI 等）
- `FundingRate`: Binance perp funding 日次平均
- `OnchainMetric`: CoinMetrics データ
- `VirtualPortfolioState`: 仮想 P&L（USD 建て）
- `ActualPortfolioState`: 実 P&L（JPY 建て、GMO）
- `OrderLog`: 発注・約定履歴
- `BacktestRun` / `WalkForwardRun` / `Trade`: backtest 結果

## DB 構成（Railway Postgres）

```
Railway Project: kameyama-system
  └── Postgres service: auto-stock-trader DB（既存、共有）
        └── Database: railway
              ├── Schema: public                ← auto-stock-trader（別 project）
              └── Schema: auto_crypto_trader    ← 本 project
```

- 同 Postgres インスタンスを **schema 単位で分離**（追加コスト ~$0.05/月）
- DATABASE_URL に `?schema=auto_crypto_trader` を必ず付与
- ローカル開発時は `localhost:5432/auto_crypto_trader?schema=public`

## 取引所制約

### GMO Coin spot

| 項目 | 値 |
|---|---|
| 最小ロット (BTC) | 0.0001 BTC |
| 最小ロット (ETH) | 0.01 ETH |
| Maker fee | -0.05%（リベート）|
| Taker fee | 0.05% |
| API rate limit | private 6 req/秒 |
| 出金権限 | API key で OFF（重要）|

### データソース

| データ | ソース | 注意 |
|---|---|---|
| BTC/ETH 日足 | Binance kline | GitHub Actions IP で 451 ありうる → DB cache fallback 実装済 |
| DXY 日足 | yfinance (sidecar) | 同上 |
| Funding rate | Binance | 同上 |
| On-chain | CoinMetrics community API | free tier、daily delay |
