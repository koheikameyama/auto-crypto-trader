# Phase 3: Funding Rate Arbitrage - Architecture

## 概要

Phase 3では、既存のdirectional戦略（Scheme E）とは独立したリターンドライバーを持つ、funding rate arbitrage戦略を追加する。

## 戦略の位置づけ

| Phase | 戦略 | リターンドライバー | リスク | 取引所 |
|---|---|---|---|---|
| Phase 2 | Directional (Scheme E) | 市場方向（ベータ） | 市場リスク | GMO Coin（現物） |
| Phase 3 | Funding Arb | Funding rate（キャリー） | 清算リスク、基差リスク | GMO Coin（現物）+ Binance（perp） |

**重要**: Phase 2とPhase 3はリターンドライバーが完全に独立しているため、ポートフォリオ全体の分散効果が高い。

## アーキテクチャ

### データフロー

```
[Binance API]
  ↓ (8時間ごと)
  Funding Rate収集
  ↓
[FundingRateDetail]

[GMO Coin API]   [Binance API]
  ↓ (毎日10:05)   ↓ (毎日10:05)
Spot Price収集   Perp Price収集
  ↓                ↓
[SpotPrice]      [PerpPrice]

        ↓ ← ← ← ↓
  [Arb Calculator]
        ↓
  閾値判定（entry/exit）
        ↓
[FundingArbPortfolio] 更新
        ↓
  （Phase 3.2以降）実発注
```

### 主要コンポーネント

| ファイル | 役割 |
|---|---|
| `src/data/binance-perp-client.ts` | Binance perp REST API クライアント |
| `src/data/binance-funding-loader.ts` | Funding rate 収集・DB保存 |
| `src/live/funding-arb-calculator.ts` | Arbitrage機会判定（Phase 3.1で実装） |
| `src/live/funding-arb-simulator.ts` | Virtual portfolio 更新（Phase 3.1で実装） |
| `src/live/funding-arb-executor.ts` | 実発注（Phase 3.2で実装） |

## Prisma モデル

### Phase 3専用モデル

```prisma
// 8時間ごとの詳細funding rate
model FundingRateDetail {
  symbol    String   // BTCUSDT, ETHUSDT
  timestamp DateTime // UTC (00:00, 08:00, 16:00)
  rate      Float    // e.g., 0.0001
  markPrice Float?
}

// GMO Coin現物価格
model SpotPrice {
  symbol    String   // BTC, ETH
  timestamp DateTime // UTC
  price     Float    // JPY
}

// Binance perp価格
model PerpPrice {
  symbol    String   // BTCUSDT, ETHUSDT
  timestamp DateTime // UTC
  price     Float    // USDT
  markPrice Float?
}

// Funding arb専用portfolio state
model FundingArbPortfolio {
  asset                String   // BTC, ETH
  date                 DateTime // JST date
  spotPositionUnits    Float    // 現物ポジション
  perpPositionUnits    Float    // perpポジション（負値）
  netDeltaJpy          Float    // デルタ（≈0）
  fundingEarnedJpy     Float    // 本日のfunding収入
  totalEquityJpy       Float    // 総資産
  marginRatioPercent   Float?   // Binance証拠金維持率
}

// Arbitrage機会記録（分析用）
model ArbOpportunity {
  symbol           String
  timestamp        DateTime
  fundingRate      Float
  annualizedReturn Float
  thresholdMet     Boolean
  actionTaken      String?
}
```

## Phase 3.0: Setup & Design（進行中）

**目標**: Binance perp API接続、データ収集基盤の構築

**タスク**:
- [x] Prisma schemaにfunding arb用モデル追加
- [x] Binance perp APIクライアント実装
- [x] Funding rate loader実装
- [x] Test script作成（`scripts/test-binance-connection.ts`）
- [x] Backfill script作成（`scripts/backfill-funding-rates.ts`）
- [ ] Migration実行
- [ ] 過去1年分のfunding rateデータ収集
- [ ] 戦略パラメータ（entry/exit閾値）のbacktest

## Phase 3.1: Virtual Tracking

**目標**: 実発注なしで、P&L計算のみ実行（1ヶ月程度）

**実装予定**:
- `src/live/funding-arb-calculator.ts` — Entry/exit判定
- `src/live/funding-arb-simulator.ts` — Virtual portfolio更新
- `scripts/daily-funding-arb-virtual.ts` — 日次実行スクリプト

**GitHub Actions workflow**:
```yaml
name: Daily Funding Arb (Virtual)
on:
  workflow_dispatch:
schedule:
  cron: '5 1 * * *'  # 10:05 JST (= 01:05 UTC)

jobs:
  funding-arb-virtual:
    steps:
      - Funding rate収集
      - Spot/Perp価格収集
      - Arb機会判定
      - FundingArbPortfolio更新
      - Slack通知
```

## Phase 3.2: 実資金運用

**目標**: GMO Coin（現物）+ Binance（perp）で実発注

**実装予定**:
- `src/live/funding-arb-executor.ts` — GMO + Binanceへの発注
- Kill switch（連続失敗、証拠金維持率低下、異常funding rate）
- Daily rebalance（デルタ調整）

**初期規模**: ¥30,000〜¥50,000程度（Phase 2.1 Microと同等）

## リスク管理

### 1. デルタニュートラル維持

```
net_delta = spot_position + perp_position
target: net_delta ≈ 0 (±5%以内)
```

Daily rebalanceでデルタを調整。

### 2. 清算リスク回避

Binance perpの証拠金維持率を監視:
```
margin_ratio = equity / position_notional
alert: < 150%
action: < 120% （追加証拠金またはポジション縮小）
```

### 3. Kill Switch

以下の条件で自動停止:
- 連続3回以上の発注失敗
- Funding rate が異常値（> 1% または < -1%）
- 証拠金維持率 < 120%
- API エラーが5分以上継続

## Phase 2との統合

### 同じインフラを共有

- Railway Postgres（同じDBインスタンス、schemaで論理分離）
- GitHub Actions（workflow分離）
- GMO Coin API（Phase 2も使用）
- Slack通知、Healthchecks.io

### 独立性の確保

- `EXECUTION_ENABLED_PHASE3` — Phase 3の実行制御（Phase 2とは別）
- `FundingArbPortfolio` — Phase 3専用のportfolio state
- 戦略パラメータは完全に独立

### 統合ダッシュボード（Phase 3.2以降）

```bash
npx tsx scripts/portfolio-dashboard.ts --all

[Phase 2: Directional]
Equity: ¥120,000 (+20% since start)
Position: BTC 0.005, ETH 0.05
Today: +¥500

[Phase 3: Funding Arb]
Equity: ¥35,000 (+16.7% since start)
Position: Spot BTC 0.003, Perp -0.003
Net Delta: ¥0 (0.0%)
Funding Earned Today: +¥120

[Total Portfolio]
Total Equity: ¥155,000
Today P&L: +¥620
```

## 次のステップ

1. **Phase 3.0完了**
   - Migration実行（`npx prisma migrate dev --name add-funding-arb-models`）
   - 過去1年分のfunding rate backfill
   - Backtest実行、entry/exit閾値の最適化

2. **Phase 3.1開始**
   - Virtual tracking実装
   - 1ヶ月程度運用して有効性検証

3. **Phase 3.2移行判断**
   - Virtual tracking でSharpe > 2.0, max DD < 10%ならPhase 3.2へ進む
