# Round 4d: Risk-Managed Buy & Hold（段階的発展）

**作成日:** 2026-04-23
**前提:** Round 4c で部分 positive（DD 83%→43%、Sharpe 犠牲）。これを発展させ「BH を超える Sharpe or 同等 Sharpe で DD 半減」を狙う
**スコープ:** BTC 単独、無料データのみ、本 repo 内
**想定工数:** 4-6 時間（3 step 構成、各 step で go/no-go 判定）

---

## 1. 背景と目的

### 本 repo の 6 ラウンドで得た positive / negative

- **Negative**: 予測ベースの単純戦略は全滅 (5/5 FAIL)
- **Partial Positive (R4c)**: オンチェーン regime filter で DD を BH の半分に。ただし Sharpe も同時に削減
- **確定事実**: BTC BH が 10年 Sharpe 1.102 で最強ベンチマーク

### 本ラウンドの問い

**Q**: Round 4c の「DD 削減、Sharpe 犠牲」の trade-off を、もっと有利にできるか？
- Baseline: BH (Sharpe 1.1、DD 83%)
- R4c: Sharpe 0.68、DD 43%
- **目標**: Sharpe ≥ 1.0 AND DD ≤ 50% → Sharpe 維持しつつ DD を BH の 60% 以下に

---

## 2. Step 構成と Go/No-Go

### Step 1: Trailing Stop BH（最小 baseline）

**戦略:**
- 常時 BTC long、ただし「ATH から `trailDrawdown`% 下落」で cash に退避
- cash 期間中、価格が一時底から `reentryGain`% 戻ったら再参入
- いかなる regime signal も使わない（価格のみ）

**パラメータ:**
- `trailDrawdown`: [20, 30, 40]
- `reentryGain`: [10, 20, 30]

**Go/No-Go 基準:**
- **Go**: OOS Sharpe > R4c の 0.68 OR DD < R4c の 43%
- **No-Go**: 上記未達 → Step 2 へ

**なぜこれを baseline にするか:**
- 一切 external data を使わない最もシンプルな risk management
- これが R4c を超えられるなら「onchain 指標は冗長」の証拠
- 超えられないなら「外部 signal が必要」の motivated 根拠

### Step 2: DXY + VIX マルチシグナル regime

**戦略（Step 1 が No-Go の場合）:**
- Baseline は Step 1 の trailing stop
- 追加 regime filter:
  - **DXY regime**: DXY が上昇トレンド (200日 SMA 上回る) なら crypto risk-off → position size を 50% に削減
  - **VIX regime**: VIX > threshold (例: 30) なら risk-off → position を 0% (cash)
- 複合: base BTC position × DXY multiplier × VIX multiplier

**データ追加:**
- yfinance 経由で DXY (`DX-Y.NYB`) と VIX (`^VIX`) を 10年分 backfill
- `MacroBar` テーブル追加 or `DailyBar` に asset を追加

**パラメータ:**
- `dxySmaPeriod`: [100, 200]
- `vixThreshold`: [25, 30, 35]
- 上記 + Step 1 params

**Go/No-Go 基準:**
- Go: OOS Sharpe ≥ 1.0 AND DD ≤ 50%
- No-Go: Step 3 へ

### Step 3: Continuous sizing + Funding rate

**戦略（Step 2 も No-Go の場合）:**
- Binary/fractional から **continuous position sizing** へ
- Position = base × f(nvtPercentile, dxyRegime, vixRegime, fundingRate)
- Funding rate は Binance 公開 API から取得（過去 3 年分程度）
- 方針: funding 高 = 過熱 → サイズ削減、funding 低 = 割安 → サイズ維持

**データ追加:**
- Binance Futures API (`/fapi/v1/fundingRate`) から過去 funding history
- `FundingRate` テーブル追加

**Go/No-Go:**
- Go: OOS Sharpe ≥ 1.0 AND DD ≤ 50%
- No-Go: 打ち切り、本 repo を完全クローズ（3 度目）

---

## 3. 共通仕様

### 評価基準（全 Step 共通）

| KPI | 閾値 | R4c 実績 | 目標 |
|---|---|---|---|
| OOS Sharpe | ≥ 1.0 | 0.684 | 1.0 超 |
| OOS Max DD | ≤ 50% | 42.73% | 維持 or 改善 |
| IS→OOS drop | ≤ 30% | 49.3% | 改善 |
| vs BH Sharpe | 必達 | NO | YES (1.102 超) |

### 実装戦略

- **新 engine**: `src/backtest/managed-bh-engine.ts`（continuous sizing 対応）
- **既存流用**: `runner-helpers`、`metrics`、`buy-and-hold`
- **WF wrapper**: `src/walk-forward/managed-bh-engine.ts`
- **indicators**: 既存 `onchain-indicators.ts` に `trailingStopSignal`, `dxyRegime`, `vixRegime` を追加

### 工数見積（各 Step 独立）

| Step | 実装 | 実行 | 判定 | 累積 |
|---|---|---|---|---|
| Step 1 | 45-60分 | 10分 | 5分 | 1h |
| Step 2 | 60-90分 | 30-60分 | 10分 | +2h = 3h |
| Step 3 | 90-120分 | 30-60分 | 10分 | +2.5h = 5.5h |

各 Step が Go だったらそこで終了（結果 good）。

---

## 4. リスクと注意

1. **Step 1 の過学習リスク**: trailingDrawdown を IS 最適化すると各体制に特化する。3 param 値の固定を重視、WF drop を厳しくチェック
2. **DXY / VIX の時差**: US 営業日のみ取引、crypto 24/7 との align が必要。前営業日値を使う forward-fill 採用
3. **Funding rate の歴史**: Binance USDT-M perp は 2020年頃から。10年フルカバーは無理 → Step 3 は 4-5年に短縮
4. **IS→OOS drop の検出**: 各 step で drop > 30% なら過学習疑い、continuous sizing では特に注意

---

## 5. 成果物

- Step ごとに:
  - コード（engine、indicators、scripts）
  - Tests
  - WF 結果の md レポート
  - DB に `WalkForwardRun` 行追加
- 最終レポート `docs/specs/round-4d-findings.md`:
  - Step 1/2/3 の go/no-go 判定
  - R4c と比較した最終 Sharpe / DD
  - 本 repo のクローズ判定（or 追加 research の提案）

---

## 6. 明示的に「やらないこと」

- Glassnode 有料 tier（今回は課金しない）
- MVRV / NUPL（Glassnode paid のため）
- 時間足より細かい時間軸
- ETH / altcoin の on-chain 拡張
- ML モデル（XGBoost / LSTM etc. は過学習懸念から）
- オプション戦略や perp アービトラージ

これらは別 repo の候補。
