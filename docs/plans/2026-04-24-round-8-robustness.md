# Round 8: Scheme E 頑健性検証（Weight Sensitivity + ETH Cross-Asset）

**作成日:** 2026-04-24
**前提:** R7 Scheme E (DXY 0.60 + Funding 0.40, 2-signal) が 6.5y BTC で strict criteria 全 PASS (Sharpe 1.096, drop 15%, beats BH +26%)
**目的:** Scheme E が**真の edge か、local overfit か**を最小コストで判別
**想定工数:** 2-3 時間

---

## 1. 検証すべき懸念

R7 時点での残るリスク:

1. **Weight 0.60/0.40 の手選び**: 私が correlation 分析から「感覚で」選んだ値。最適化ではない → たまたま 6.5y に fit した可能性
2. **6.5y の macro 特殊性**: 2019-2021 緩和 + 2022 引き締め + 2023+ mixed → DXY + Funding の coordinated signal が特に効く環境だった可能性
3. **BTC 単独検証**: ETH で同じ 2-signal が機能するかは未検証
4. **Strategy-level overfitting**: Parameter 単位の drop 15% とは別次元の問題

---

## 2. Step 1: Weight Sensitivity Grid

### 検証内容

Scheme E の weight を grid search で変えて Sharpe の変化を観察:
- `wDxy ∈ [0.40, 0.45, 0.50, 0.55, 0.60, 0.65, 0.70, 0.75]`
- `wFunding = 1 - wDxy`（合計 1.0 固定）
- その他のパラメータ（dxySmaPeriod, fundingLookback, rebalanceThreshold）は Scheme E 最適値で固定

### 判定基準

- **頑健**: `wDxy ∈ [0.50, 0.70]` の広い範囲で Sharpe ≥ 1.0
- **局所 fit**: Sharpe ≥ 1.0 が (0.60, 0.40) 近辺のみ
- **NO edge**: 全ての weight で Sharpe < 1.0（起きない想定だが念のため）

### 実装

既存の `weighted-ensemble-engine.ts` をそのまま使う（wOnchain/wVix/wTnx = 0 固定、wDxy と wFunding のみ変える）。新規 script: `scripts/weight-sensitivity-scheme-e.ts`

---

## 3. Step 2: ETH Cross-Asset Validation

### データ準備

**ETH 用の funding rate backfill が必要:**
- Binance ETHUSDT perp も BTCUSDT と同じ `/fapi/v1/fundingRate` endpoint で取得可能
- 2019-11 頃からデータあり（6.5y 近く）
- 既存の `fetchFundingDaily` / `FundingRate` テーブルに `symbol` カラムで区別

手順:
1. `/funding/daily?symbol=ETHUSDT` で backfill（既存 sidecar endpoint 流用）
2. `FundingRate` テーブルに ETHUSDT で投入（ticker column で区別）

### 検証内容

Scheme E (wDxy=0.60, wFunding=0.40) の設定を変えずに ETH に適用:
- `asset = "ETH-USD"` (ETH bar, 8.5y backfill 済)
- `fundingBars` = ETHUSDT funding rate
- DXY / その他の signal は共通（BTC と同じ）
- 同じ WF 設定 (365/182/182)
- BH benchmark: ETH の BH Sharpe / DD

### 判定基準

- **Cross-asset valid**: ETH OOS Sharpe ≥ 0.9 AND Beats ETH BH AND Drop ≤ 30%
- **BTC-specific**: Sharpe や drop が大きく劣化（e.g. Sharpe < 0.5、drop > 50%）

### 実装

- `src/data/funding-loader.ts` は既に `symbol` 引数を受け取る → そのまま使える
- `scripts/backfill-funding-rate.ts` に ETHUSDT を追加 or 新規 script
- `scripts/walk-forward-scheme-e-eth.ts`: ETH 単独の WF（BTC-USD → ETH-USD に変更、funding を ETHUSDT 切替）

**注意:** `weighted-ensemble-engine.ts` は現状 BTC-USD ハードコード（applyFee で）。ETH 対応のため、`asset: AssetSymbol` を入力に追加する必要あり。

---

## 4. Step 3: 総合判定

### 両 PASS
- Scheme E は真の edge → **Round 9 で実運用準備**（paper trading、daily data pipeline）

### Weight sensitivity PASS, ETH FAIL
- 2-signal の weight は堅牢だが、macro edge は BTC-specific
- BTC 単独運用を考慮、cross-asset は諦める

### Weight sensitivity FAIL, ETH PASS（不自然だが）
- 偶然の weight 最適化、実際の edge は別のところ
- 再分析必要

### 両 FAIL
- Scheme E は locally overfit
- Round 7 の結論を撤回、R6 v4 あたりに戻して再設計

---

## 5. リスクと注意

1. **ETH funding rate の期間ズレ**: ETHUSDT perp は 2019-11 頃からで BTC より少し短い
2. **weighted-ensemble-engine の asset ハードコード**: `applyFee("BTC-USD", ...)` を引数化する必要
3. **ETH BH の特殊性**: ETH は BTC と違い 2018-2020 の長い bear market、2021 bull、2022 crash → 独立な regime があり検証価値高い
4. **weight sensitivity で「wDxy=0.60 が必ずベスト」が出なくても心配しない**: 近傍で Sharpe ≥ 1.0 が維持されれば OK

---

## 6. 成果物

- コード:
  - `src/backtest/weighted-ensemble-engine.ts` 修正（asset 引数化）
  - `scripts/weight-sensitivity-scheme-e.ts` (Step 1)
  - `scripts/backfill-funding-rate.ts` 拡張 (ETHUSDT)
  - `scripts/walk-forward-scheme-e-eth.ts` (Step 2)
- DB: `FundingRate` に ETHUSDT 約 2,300 rows、`WalkForwardRun` 1-2 rows
- レポート: `docs/specs/round-8-findings.md`

---

## 7. タイムボックス

| Step | 目安 |
|---|---|
| Engine asset 引数化 | 15-20分 |
| Step 1: weight sensitivity | 30分 |
| ETHUSDT funding backfill | 15分 |
| Step 2: ETH WF | 30-45分 |
| Findings 執筆 | 30分 |
| **合計** | **約 2-2.5h** |
