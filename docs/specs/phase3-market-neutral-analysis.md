# Phase 3: Market Neutral Strategy - BTC-ETH Pair Trading Analysis

**Date**: 2026-07-18
**Status**: ⏸️ **ON HOLD** (Backtest results negative)

## 実施した分析

### 1. Rolling Window Analysis

**期間**: 全期間（2017-08-17 〜 2026-07-18、3258日）

#### Half-life by Window

| 期間 | Days | Half-Life | Auto-Corr | CV | 評価 |
|---|---|---|---|---|---|
| **最近 3ヶ月** | 90 | **10.2日** | 0.9285 | 4.3% | ✅ **優秀** |
| **最近 6ヶ月** | 180 | **16.4日** | 0.9584 | 5.9% | ✅ **良好** |
| 最近 1年 | 365 | 62.0日 | 0.9866 | 11.5% | ❌ 不適 |
| 最近 2年 | 730 | 92.4日 | 0.9924 | 22.4% | ❌ 不適 |
| 最近 3年 | 1095 | 232.6日 | 0.9965 | 32.6% | ❌ 不適 |
| 全期間 | 3258 | 307.9日 | 0.9976 | 45.1% | ❌ 不適 |

#### 主要な発見

**✅ 最近3-6ヶ月は良好な平均回帰**:
- Half-life 10-16日 = 約2週間で偏差が50%減衰
- ペアトレーディングの理想的な速度
- CV 4-6% = 比較的安定したレンジ

**⚠️ 長期的には不安定**:
- 1年以上の期間では平均回帰が遅い（half-life > 60日）
- Regime change が頻繁に起こる
- 構造的な BTC dominance の変化

### 2. Backtest Results（最近180日）

**パラメータグリッド**:
- Entry thresholds: 1.0, 1.5, 2.0
- Exit thresholds: 0.0, -0.5
- Lookback days: 90, 120, 180
- 総組み合わせ: 18パターン

**結果**: **すべての組み合わせで負のリターン**

| 指標 | ベスト | ワースト |
|---|---|---|
| Sharpe Ratio | **-1.72** | -2.12 |
| 年率リターン | **-12.15%** | -14.96% |
| Max Drawdown | 5.55% | 8.37% |
| Win Rate | 42.1% | 26.3% |
| Total Trades | 19-58回 | - |
| Avg Holding | **1日** | - |

#### 異常な挙動

1. **平均保有期間が1日**
   - エントリー翌日に即エグジット
   - 平均回帰を待たずに損切り

2. **全パラメータで負のリターン**
   - Entry/Exit threshold を変えても改善なし
   - Lookback を変えても改善なし

3. **Win rate < 50%**
   - ランダムトレード以下

## 結論

### ❌ BTC-ETH ペアトレーディングは現時点で不適

**理由**:

1. **Rolling analysis と backtest の矛盾**
   - Rolling で half-life 10日（良好）
   - Backtest で Sharpe -1.72（壊滅）
   - 実装バグの可能性あり

2. **Regime risk が高い**
   - 3-6ヶ月は良好でも、1年前は half-life 62日
   - BTC/ETH の相対的価値が構造的に変化
   - 短期的な平均回帰は信頼性が低い

3. **サンプルサイズ不足**
   - 3ヶ月 = 90日 = 約5-10回のトレード機会
   - 過学習リスクが高い

4. **実装コストが高い**
   - バックテストのデバッグに3-5時間
   - パラメータ調整・検証にさらに時間
   - Phase 2（Sharpe 1.10）の方が確実

### ✅ 保留の判断

**BTC-ETH ペアトレーディングは一旦保留とし、以下の条件が満たされたら再検討**:

1. **Phase 2 が安定運用に入った後**
   - ETH の1ヶ月後評価（2026-08-11）を完了
   - Phase 2 の最適化が完了
   - 十分な余剰時間がある

2. **バックテスト実装の見直し**
   - P&L計算ロジックの検証
   - 複数期間でのテスト
   - Walk-forward analysis

3. **別のペア候補を検討**
   - BTC/SOL、ETH/SOL、BNB/ETH等
   - より安定した平均回帰を示すペア

## 実装した内容（Phase 3.1 準備完了）

✅ **分析ツール**:
- `scripts/analyze-btc-eth-spread.ts` - 相関・ratio統計分析
- `scripts/analyze-btc-eth-rolling.ts` - Rolling window half-life分析
- `scripts/backtest-btc-eth-pair.ts` - ペアトレーディング backtest

✅ **バックテストエンジン**:
- `src/backtest/pair-trading-engine.ts` - 汎用的なペアトレーディングエンジン
- Z-score ベースのエントリー/エグジット
- Dollar-neutral ポジショニング
- Grid search 対応

## 今後の方針

### 短期（今後3-6ヶ月）

**Phase 2 Directional に集中**:
- 既存戦略（Scheme E）の安定運用
- ETH の1ヶ月後評価（2026-08-11）
- 資金管理・リスク管理の改善

### 中長期（6-12ヶ月後）

**Phase 3 の再評価**:
- 四半期ごとに BTC-ETH spread を確認
- Half-life が安定的に < 30日を維持していれば再検討

**Alternative strategies**:
- Deribit オプション戦略（vol risk premium）
- 別のペア候補（BTC/SOL、ETH/SOL等）
- US株ペア（SPY/QQQ、セクターペア）

## 学び

### ✅ Rolling analysis だけでは不十分

- Half-life が良好でも実際のトレーディングで機能するとは限らない
- バックテストでの検証が必須
- 複数期間・複数パラメータでの頑健性確認が重要

### ✅ Regime risk の重要性

- 暗号資産市場は regime change が頻繁
- 短期的な統計特性に依存する戦略はリスクが高い
- 長期的に安定した統計特性を持つ戦略を優先すべき

### ✅ 実装したコードは無駄ではない

- 将来、市場環境が変わったら即座に再開できる
- Pair trading engine は汎用的（他のペアにも適用可能）
- 分析スクリプトは他の戦略検討時にも参考になる

## 参考

- 実装コード:
  - `src/backtest/pair-trading-engine.ts`
  - `scripts/analyze-btc-eth-spread.ts`
  - `scripts/analyze-btc-eth-rolling.ts`
  - `scripts/backtest-btc-eth-pair.ts`
