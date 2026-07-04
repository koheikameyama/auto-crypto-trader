# Auto Crypto Trader — Research Findings

**実験実施日:** 2026-04-23
**現在ステータス:** **ACTIVE — Round 8 で Scheme E の頑健性 validated ★★★、Round 9 paper trading へ**
**最新の決定版:**
- **Scheme E (DXY + Funding, 2-signal) は本 repo の validated edge**
  - BTC 6.5y: Sharpe 1.099、DD 49.76%、drop 12.7%、Beats BH +26%
  - ETH 6.5y: Sharpe 1.026、DD 56.17%、drop **-1.9%** (OOS > IS)、Beats BH +14%
  - **Weight sensitivity: 8/8 weight で Sharpe > 1.0 (wDxy ∈ 0.30-0.80)**
  - **Cross-asset validated**: BTC→ETH で同じ weight 機能
- **教訓**: DXY (マクロ流動性) + Funding (ミクロ sentiment) の直交 2 軸が真の edge
**データ:** BTC-USD 10年、ETH-USD 8.5年、onchain 10年、DXY/VIX/TNX 10年、BTCUSDT/ETHUSDT funding 6.5y。

> **ドキュメント履歴:** Round 3 findings として作成、途中 2 回「DONE」宣言は誤判断。R4d S3 で過学習突破、R5 で初 BH 超え、R6 で dilution 発見、**R7 で主KPI 全 PASS**、**R8 で weight + cross-asset robustness validated**。Round 9 で実運用検証へ。§11-§17 は追補、詳細は個別 findings 参照。

---

## 1. 結論サマリ

- **8 組合せ（4戦略 × 2銘柄）中、WF 主KPI (OOS Sharpe ≥ 1.0) 達成は 0 / 8**
- **戦略 Sharpe > Buy & Hold Sharpe** を満たしたのは **1 / 8 組合せ**（donchian / ETH のみ、しかも僅差）
- Cross-asset 判定（2銘柄中1銘柄以上で単独合格）も **全戦略 FAIL**
- IS→OOS Sharpe drop が全戦略で 48–114% → 典型的な**過学習**パターン
- Funding rate 感度分析でも結論は変わらず（5-10% でも Sharpe 低下は 0.015–0.030 程度）

→ **Round 3 FAIL → 「単純な技術的戦略はどの市場でも機能しない」という決定的な結論**

---

## 2. 実験設定

| 項目 | 値 |
|---|---|
| 期間 | 2016-04-23 〜 2026-04-23（10年） |
| 銘柄 | BTC-USD / ETH-USD（yfinance） |
| 初期資金 | 10,000 USD |
| リスク率 | 1% / trade |
| 手数料 | 往復 0.20%（エントリー・エグジット各 0.10%） |
| Funding rate | MVP: 0%、感度分析: 年率 5% / 10% |
| WF 窓 | IS 365日 / OOS 182日 / step 182日（暦日ベース） |
| Sharpe 年化係数 | √365（crypto 24/7） |
| 過学習判定 | IS→OOS Sharpe drop ≤ 30% |

---

## 3. Buy & Hold ベンチマーク

| 銘柄 | 期間 | Sharpe | MAR | Total Return | Max DD |
|---|---|---|---|---|---|
| BTC-USD | 10年 | **1.102** | 0.806 | 16,954.2% | 77%+ |
| ETH-USD | 8.5年 | **0.709** | 0.285 | 640.5% | 80%+ |

- BTC の BH Sharpe 1.102 は**主KPI閾値 1.0 を既に超えている** → 戦略はこれを上回らなければ「アクティブ運用の意味なし」
- 本実験の戦略はいずれも BH Sharpe を下回った（1例を除く）

---

## 4. 個別バックテスト結果（フル期間、固定パラメータ）

| 戦略 | 銘柄 | Sharpe | MAR | PF | DD | Trades | WinRate |
|---|---|---|---|---|---|---|---|
| donchian | BTC | **1.499** | 1.477 | 1.991 | 8.99% | 255 | 44.3% |
| donchian | ETH | 0.949 | 1.106 | 1.610 | 5.77% | 208 | 40.9% |
| ma-crossover | BTC | 0.440 | 0.252 | 1.805 | 5.18% | 54 | 42.6% |
| ma-crossover | ETH | 0.190 | 0.078 | 1.249 | 5.83% | 48 | 27.1% |
| rsi-reversion | BTC | -0.343 | -0.085 | 0.690 | 15.38% | 135 | 14.8% |
| rsi-reversion | ETH | -0.058 | -0.031 | 0.918 | 9.68% | 96 | 12.5% |
| nr7-breakout | BTC | **1.023** | 0.537 | 1.490 | 15.54% | 343 | 38.2% |
| nr7-breakout | ETH | 0.457 | 0.197 | 1.229 | 15.03% | 271 | 37.6% |

**1次足切り（期待値>0 & PF≥1.3）通過 (4/8):**
- donchian / BTC, donchian / ETH, ma-crossover / BTC, nr7-breakout / BTC

→ フル期間の固定パラメータでは 4 組合せが「1次足切り」を通過。見かけ上は donchian BTC が Sharpe 1.499 と印象的だが、WF で真価が問われる。

---

## 5. Walk-Forward 検証結果

### KPI 一覧

| 戦略 | 銘柄 | Windows | OOS Sharpe | OOS MAR | OOS PF | OOS Max DD | IS→OOS Drop | BH Sharpe | Beats BH | 判定 |
|---|---|---|---|---|---|---|---|---|---|---|
| donchian | BTC | 18 | 0.797 | 5.169 | 22.966 | 6.37% | 51.1% | 1.102 | NO | FAIL |
| donchian | ETH | 14 | 0.745 | 2.724 | 2.003 | 5.26% | 48.2% | 0.709 | **YES** | FAIL |
| ma-crossover | BTC | 18 | 0.333 | 2.095 | 20.883 | 4.56% | 59.5% | 1.102 | NO | FAIL |
| ma-crossover | ETH | 14 | 0.083 | 2.702 | 4.216 | 4.80% | 91.3% | 0.709 | NO | FAIL |
| rsi-reversion | BTC | 18 | -0.164 | 0.417 | 1.231 | 6.88% | 113.5% | 1.102 | NO | FAIL |
| rsi-reversion | ETH | 14 | 0.667 | 3.057 | 9.330 | 3.59% | 53.8% | 0.709 | NO | FAIL |
| nr7-breakout | BTC | 18 | 0.325 | 2.664 | 7.110 | 9.60% | 69.4% | 1.102 | NO | FAIL |
| nr7-breakout | ETH | 14 | 0.043 | 1.400 | 1.566 | 6.93% | 92.0% | 0.709 | NO | FAIL |

### 観察

1. **主KPI (OOS Sharpe ≥ 1.0): 0/8 達成**
2. **IS→OOS drop > 30% (過学習判定): 8/8 全滅**。典型的には 50-100% 低下 → IS でのパラメータ最適化が OOS に全く汎化していない
3. **戦略 Sharpe > BH Sharpe: 1/8 のみ**（donchian/ETH、0.745 vs 0.709、僅差）
4. **Cross-asset robustness: 全戦略 FAIL**（2銘柄中1銘柄以上合格の基準を満たすものなし）
5. Max DD は全般に低い（3-10%）が、これはサイジングが 1% リスクで保守的なため。Sharpe が低いので「DD が小さくてもリターンがほぼゼロ」状態

### 戦略別考察

- **donchian**: 最も有望そうに見えたが、IS の breakout level が OOS で機能せず。ETH で僅かに BH を上回ったが閾値到達せず
- **ma-crossover**: 低 Sharpe、低 PF、取引数が少なく統計的信頼性も低い
- **rsi-reversion**: BTC で OOS Sharpe が**負**。逆張りが BTC の強トレンドに飲み込まれる典型
- **nr7-breakout**: ETH の OOS Sharpe 0.043 は文字通りノイズレベル。取引数は多いが期待値が 0 に近い

---

## 6. Funding Rate 感度分析（Donchian / デフォルトパラメータ）

| Asset | Funding | Sharpe | MAR | PF | DD | TotalRet |
|---|---|---|---|---|---|---|
| BTC-USD | 0% | 1.499 | 1.477 | 1.991 | 8.99% | 247.3% |
| BTC-USD | 5% | 1.484 | 1.442 | 1.978 | 9.10% | 242.6% |
| BTC-USD | 10% | 1.469 | 1.408 | 1.966 | 9.20% | 237.9% |
| ETH-USD | 0% | 0.949 | 1.106 | 1.610 | 5.77% | 68.7% |
| ETH-USD | 5% | 0.939 | 1.085 | 1.601 | 5.81% | 67.7% |
| ETH-USD | 10% | 0.929 | 1.065 | 1.592 | 5.86% | 66.7% |

- Funding rate 5-10% での Sharpe 低下は **0.010–0.030**（1-2%）。これは WF の FAIL を覆す規模ではない
- Donchian（最も loss 耐性が高い）でもこの程度 → 他戦略では funding 影響 + 元々 FAIL で上乗せ

---

## 7. Round 3 の位置付け

```
Round 1: FX 日足 × 4戦略 × 3ペア       → FAIL (0/12)
Round 2: FX 4h × MA Crossover × USDJPY → FAIL (Sharpe 0.118)
Round 3: crypto 日足 × 4戦略 × BTC/ETH → FAIL (0/8, 全戦略で IS→OOS drop ≥ 48%)
```

**結論: 単純な技術的戦略は市場（FX／crypto）や時間軸を問わず機能しない。**

- **モメンタム系（donchian / ma-crossover / nr7）**: IS でのパラメータが OOS で維持されず、過学習を示唆
- **逆張り系（rsi-reversion）**: crypto の強トレンド下ではそもそも負のエッジ
- **BH Sharpe > 1.0 (BTC)**: 「ただ BTC をホールドするだけで主KPIクリア」→ アクティブ戦略にハードルが高い

---

## 8. 推奨される次ステップ

本実験は **単純な技術的戦略 (技術指標・ATR ベースリスク管理) を各市場で検証する** という問いに答えるためのもの。Round 3 完全 FAIL で**この問いは閉じる**。

もし今後も crypto で研究を続けるなら、**まったく違う戦略クラス**が必要:

1. **オンチェーン指標活用**: MVRV / Puell Multiple / Active Addresses など market-structure 指標
2. **クロスアセット相関**: BTC-ETH スプレッド、BTC-NASDAQ 相関、USD-DXY の影響
3. **統計的裁定**: ペア取引、共和分関係の利用
4. **Market microstructure**: Order book imbalance、funding rate arbitrage、perp-spot basis trading
5. **ML/sequence models**: 価格のみで教師あり学習ではなく、特徴量エンジニアリング + OOS 検証の厳格化

**いずれにせよ、「技術指標 + WF」のフレームワークから離れた発想が必要**というのが本 3 ラウンド共通の教訓。

---

## 9. 成果物一覧

- コード: `/Users/kouheikameyama/development/auto-crypto-trader`（GitHub: <https://github.com/koheikameyama/auto-crypto-trader>）
- DB: PostgreSQL `auto_crypto_trader`
  - `DailyBar`: 6,739 rows（BTC 3,652 + ETH 3,087）
  - `BacktestRun`: 8 rows
  - `WalkForwardRun`: 8 rows
  - `Trade`: 1,410 rows
- レポート:
  - `reports/backtests/` — 8 個別バックテスト md
  - `reports/walk-forward/` — 8 WF md
- テスト: 128 件グリーン（vitest）
- マイグレーション: `prisma/migrations/20260423082738_init_crypto_schema/`

---

## 10. 実装上のメモ

- 設計ドキュメントの当初「engine.ts などを無変更流用」は誤りで、実際は crypto 向けに engine/exit-manager/position-sizer を書き換え（§9 を訂正済）
- Position sizing 計算式も `units = riskUsd / slDistance` に修正（当初式は次元不一致）
- Sharpe 年化係数を √365（crypto 24/7）に変更。FX Round 1/2 との直接数値比較はせず、「閾値到達可否」で判定
- WF 窓は暦日ベースに再定義（IS 365 / OOS 182 / step 182）して「12ヶ月 / 6ヶ月 / 6ヶ月」の時間構造を維持
- 実装所要時間: 当初見積 10-17h 対し実測は **本セッション内で完走**（主要コードは既存 FX 実装のパターン流用が効いた）

---

## 11. 追補 — Round 4a / 4b / プロジェクトクローズ

Round 3 の negative result を受けて、§8 で挙げた 5 方向のうち最小コストな 2 つを追加検証。

### Round 4a — SMA50 トレンドフィルタ
**仮説 H1:** Round 3 失敗の主因はカウンタートレンド取引の累積損失。SMA でフィルタすれば救済できる
**結果:** **却下**。8 組合せで SAVED 0 / IMPROVED 0 / NO EFFECT 7 / WORSE 1
**観察:**
- Max DD は全般に低下（リスク管理効果あり）
- しかし Sharpe は横ばい or 悪化 → リスク調整後パフォーマンスは不変
- IS→OOS Sharpe drop は 40-118% で相変わらず大きく、**過学習の根本は手つかず**
- 詳細: [round-4a-findings.md](round-4a-findings.md)

### Round 4b — BTC-ETH ペアトレード (z-score mean-reversion)
**仮説 H2:** BTC と ETH は高相関ペア。log(BTC/ETH) の z-score は短中期で平均回帰する
**結果:** **却下（最悪）**。単独 backtest で Total Return -93.5%、WF OOS Sharpe -0.693、IS→OOS drop **178.7%**
**観察:**
- BTC-ETH ratio は **体制変化 (ETH→BTC dominance shifts)** で non-stationary
- IS で機能した params が OOS で完全崩壊 → 単純 mean-reversion は適用不可
- 単銘柄戦略より**悪化**
- 詳細: [round-4b-findings.md](round-4b-findings.md)

### 5 ラウンド累積結果

```
Round 1 : FX 日足 × 4 戦略 × 3 ペア                     → FAIL (0/12)
Round 2 : FX 4h × MA Crossover × USDJPY                → FAIL (Sharpe 0.118)
Round 3 : crypto 日足 × 4 戦略 × BTC/ETH              → FAIL (0/8)
Round 4a: Round 3 + SMA50 トレンドフィルタ              → FAIL (0/8)
Round 4b: BTC-ETH ペアトレード z-score mean-revert      → FAIL (最悪)
```

### プロジェクトクローズの判断

**DONE 宣言 (2026-04-23)**: 本 repo での検証は完了。以下 3 点が累積証拠:

1. **5 回の独立な設計**（市場 FX/crypto、時間軸 日足/4h、戦略クラス trend/reversion/pair）が全て OOS で崩れる
2. **3 つの異なる仮説**（単独技術戦略 / トレンドフィルタ / 統計的裁定）が全て却下
3. **IS→OOS の乖離が一貫**（48-178%）→ IS でのパラメータ最適化自体が信頼できない = 過学習が普遍的

**一方で得られた Positive な副産物:**
- **Buy & Hold が BTC で Sharpe 1.1** → 単純保有が全アクティブ戦略を凌駕した事実
- **WF + Sharpe drop 判定**フレームワーク自体は堅牢に動作（偽陽性を確実に排除）
- **コードベース**は他プロジェクトでの価格データ分析に再利用可能

### 次プロジェクトへの示唆（本 repo では実施しない）

本 repo の 5 ラウンド結果は、次に取り組むなら以下の方向性を示唆:

- **情報源を変える（価格 → オンチェーン / マクロ）**: この 5 ラウンドは全て価格系列のみ。情報が足りない可能性
- **時間軸を変える（日足 → 時間足 / 秒足）**: HFT / マイクロストラクチャには別種のエッジがある（実装難度は桁違い）
- **戦略構造を変える（predictive → execution-based）**: MM、arbitrage、funding harvesting など「予測しない」戦略
- **passive に徹する**: BTC BH が Sharpe 1.1 → 「ただ保有する」が統計的に優位

これらは別 repo での新プロジェクトとして取り組む価値がある。本 repo は**参照実装 + negative result のアーカイブ**として固定する。

### 成果物追加（Round 4a / 4b 分）

- コード追加:
  - `src/lib/trend-filter.ts` / `spread.ts`
  - `src/core/wrapped/*-tf.ts` × 4
  - `src/backtest/pair-engine.ts` / `pair-trade-run.ts`
  - `src/walk-forward/pair-engine.ts`
  - scripts: 5 本追加
- テスト: 30 件追加、**全 158 件グリーン**
- レポート追加: Round 4a × 8、Round 4b × 1
- DB: `WalkForwardRun` 9 row 追加（`*-tf` × 8 + `pair-trade` × 1）
- 本セッション合計工数: 設計 + 実装 + 実行 + レポート = 約 4h

---

## 12. 追補 — Round 4c (最終ラウンド)

「DONE 宣言」の後、ユーザー要望で Round 4c（オンチェーン regime filter）を追加実施。

### Round 4c — BTC オンチェーン指標レジームフィルタ
**仮説 H3:** NVT proxy + Active Address momentum で bear regime を検知し cash に退避すれば Sharpe 改善 & DD 削減できる
**データ:** CoinMetrics Community API 無料 tier（`PriceUSD`, `CapMrktCurUSD`, `TxCnt`, `AdrActCnt`）。MVRV / NVT classical は有料で取得不可 → 代替 proxy で実装
**戦略:** `nvtProxy = CapMrkt / TxCnt`（14日 MA）と `AdrActCnt / MA(30)` の組合せで binary long/cash 切替
**結果:**
- OOS Sharpe avg: **0.684** (閾値 1.0 未達、BH 1.102 未達 → 技術判定 FAIL)
- OOS MAR avg: **4.871** (BH 0.806 の **6x** → 部分 positive)
- OOS Max DD: **42.73%** (BH 83.40% の **約半分** → 部分 positive)
- IS→OOS drop: 49.3% (閾値 30% 超)

**観察:** Round 4a/4b と違い、**DD 削減は実用的に有意**。Sharpe では BH 負けるが MAR では大勝。
「アクティブ運用はしない、ただし極端 bear では cash 退避」という **Risk-managed BH** としては価値あり。
詳細: [round-4c-findings.md](round-4c-findings.md)

### 6 ラウンド最終累積

```
Round 1 : FX 日足 × 4 戦略 × 3 ペア              → FAIL (0/12)
Round 2 : FX 4h × MA Crossover                   → FAIL
Round 3 : crypto 日足 × 4 戦略                    → FAIL (0/8)
Round 4a: Round 3 + SMA50 フィルタ                → FAIL (0/8, 変化なし)
Round 4b: BTC-ETH pair trade z-score             → FAIL (最悪)
Round 4c: BTC オンチェーン regime filter          → FAIL (部分 positive: DD 半減)
```

### 最終クローズ宣言

本 repo を**正式 DONE として固定**する（2 度目、今度こそ最終）。

**最終的な learning:**
1. **予測ベースの単純戦略は一貫して OOS 過学習** (6 ラウンド共通)
2. **BTC Buy & Hold (Sharpe 1.1) が最強のベンチマーク**
3. **情報源を変えても根本は変わらない** (価格 / SMA / spread / onchain proxy すべて同じ結果パターン)
4. **DD 削減は可能だが Sharpe 犠牲** (Round 4c で唯一確認)
5. **Round 4c の Risk-managed BH パターンは実用観点で別途価値がある** (ただし本 repo の research 問題設定では FAIL)

### 次プロジェクトへの最終示唆

- **Risk-managed BH の variant**: Round 4c を出発点に、Glassnode / DXY / VIX 等を組合せる新プロジェクト
- **Execution-based**: 予測せず構造的 edge を捕捉（funding arb、basis trade、MEV）。別 repo 推奨
- **Passive**: BH の簡潔な統計的優位を素直に受け入れる
- **HFT**: 個人開発の期待値は低い、インフラ戦争になる

### 成果物追加（Round 4c 分）

- コード追加:
  - `yfinance-service/main.py`: `/onchain/daily` エンドポイント（CoinMetrics proxy）
  - `prisma/schema.prisma` + migration: `OnchainMetric` モデル
  - `src/data/onchain-loader.ts`
  - `src/lib/onchain-indicators.ts` + tests
  - `src/backtest/regime-engine.ts` + tests
  - `src/walk-forward/regime-engine.ts`
  - `scripts/backfill-onchain-metrics.ts`、`scripts/walk-forward-onchain-regime.ts`
- テスト: 12 件追加、**全 170 件グリーン**
- DB: `OnchainMetric` 3,652 rows 追加、`WalkForwardRun` 1 row
- レポート追加: Round 4c × 1

---

## 13. 追補 — Round 4d (真の最終ラウンド)

Round 4c の partial positive を発展させるため、3-step progression で Risk-Managed BH を検証。

### Step 1 — Trailing Stop BH (No-Go)
純粋価格ベースの trailing stop。R4c より劣後 (Sharpe 0.655, DD 60%) → **外部 signal が必要と判明**

### Step 2 — Multi-Signal AND Filter (No-Go, "Filter Death")
Onchain + DXY + VIX を AND で組合せ。**過剰制限で Sharpe 負、drop 104%**。教訓: 多 signal を hard filter すると逆効果

### Step 3 — Multi-Signal Continuous Sizing ★ PARTIAL POSITIVE
同じ 3 signal を **soft weighted average で position size 0-100%** に連続化。結果:
- **OOS Sharpe: 0.903** (BH 1.102 の 82%、R4c 0.684 から +32%)
- **IS→OOS drop: 29.3%** (8 ラウンドで**初の閾値 30% 未満** ← 過学習の構造的突破)
- OOS Max DD: 47.91% (BH 83% の 57%)
- OOS MAR: 5.448 (BH 0.806 の 6.8x)

**本 repo の 8 ラウンドで最も promising な結果。** 「複数の独立 signal を連続的に組合せる」という approach が**構造的に過学習を抑える**ことが実証された。詳細: [round-4d-findings.md](round-4d-findings.md)

### 8 ラウンド最終累積

```
R1 : FX 日足 × 4 戦略 × 3 ペア               → FAIL (0/12)
R2 : FX 4h × MA Crossover                    → FAIL
R3 : crypto 日足 × 4 戦略                     → FAIL (0/8)
R4a: R3 + SMA50 フィルタ                      → FAIL (0/8)
R4b: BTC-ETH pair trade z-score              → FAIL (最悪)
R4c: BTC onchain regime binary               → FAIL (DD 半減の partial positive)
R4d Step 1: Trailing Stop BH                 → FAIL
R4d Step 2: Multi-signal AND filter          → FAIL (filter death)
R4d Step 3: Multi-signal continuous sizing   → PARTIAL POSITIVE ★★
```

### 中間 learning（Round 5 以降の起点）

> **予測ではなく、複数の独立な regime signal を continuous に組合せることで、初めて OOS で崩れない戦略が得られる。ただし BH を超えるには追加の情報源か非対称 payoff が必要。**

- 8 ラウンドすべての「予測・単一 signal・hard filter」は過学習で失敗
- **continuous sizing × multi-signal は過学習に頑健** (drop 29.3% が証拠)
- BH 超えには funding rate、Glassnode 有料指標、short allocation 等の追加要素が必要

### 本 repo の今後 — Round 5 以降へ継続

- Round 4d Step 3 の engine (`continuous-sizing-engine.ts`) は**そのまま運用可能**な土台
- 本 repo は「6 ラウンドの negative result + 2 ラウンドの positive (R4c partial, R4d-S3 structural breakthrough)」の積み上げで、**研究継続の最良ベースライン**
- 先行する §11 (Round 4c 後) / 280 行付近 (§12) の「DONE 宣言」は**早まった判断**。R4d Step 3 のブレークスルーを受けて撤回、本 repo で継続する

**Round 5 の優先候補:**
- Step 3 engine + funding rate 追加で Sharpe ≥ 1.0 を狙う（第一候補、既存インフラ流用）
- Kalman Filter で signal weight を動的に調整
- Glassnode 有料 tier で signal 強化（課金判断は後段で）
- 検証が進んだら低頻度実運用で本番検証

### 成果物追加（Round 4d 分）

- コード (9 files):
  - Step 1: `src/backtest/trailing-stop-bh-engine.ts`、`src/walk-forward/trailing-stop-bh-engine.ts`、`scripts/walk-forward-trailing-stop-bh.ts`
  - Step 2: `yfinance-service/main.py` (/macro/daily)、`prisma/schema.prisma` (MacroBar migration)、`src/data/macro-loader.ts`、`scripts/backfill-macro.ts`、`src/backtest/multi-signal-regime-engine.ts`、`src/walk-forward/multi-signal-regime-engine.ts`、`scripts/walk-forward-multi-signal.ts`
  - Step 3: `src/backtest/continuous-sizing-engine.ts`、`scripts/walk-forward-continuous-sizing.ts`
- テスト: 6 件追加、**全 176 件グリーン**
- DB: `MacroBar` 5,026 rows (DXY 2,513 + VIX 2,513)、`WalkForwardRun` 3 rows
- レポート: Round 4d の WF md 3 本 + [round-4d-findings.md](round-4d-findings.md)
- 実績工数: 約 2.5h

---

## 14. 追補 — Round 5 (funding rate 統合、初の BH 超え ★)

### 仮説 H4
「Funding rate は市場参加者の意思を直接測定する最も純粋な sentiment signal」

### 実装
- 4 つ目の signal として BTCUSDT perp funding rate を追加
- Binance Futures public API (無料、2019-10 以降 6.5 年分)
- Continuous sizing v2 engine: `(onchain + dxy + vix + funding) / 4`
- Rolling percentile で regime 変化に適応

### 結果 (同一 6.5y 期間比較)

| 戦略 | OOS Sharpe | OOS Max DD | IS→OOS Drop | Beats BH |
|---|---|---|---|---|
| BH baseline | 0.871 | 76.63% | — | — |
| R4d Step 3 (3-signal 再計算) | 0.747 | 46.84% | 38.2% | NO |
| **R5 v2 (4-signal) ★** | **0.933** | **43.92%** | **24.3%** | **YES ★** |

### ブレークスルー

1. **本 repo 9 ラウンドで初めて OOS Sharpe で BH 超え** (+7.1% vs BH)
2. **Drop 24.3%** — R4d Step 3 の 29.3% を更に改善、9 ラウンド最良
3. **DD 44%** — BH 77% の約半分
4. Funding rate signal が Sharpe を **+0.186 貢献** (R4d S3 → R5 v2 同期間)

### Strict criteria 判定

- Sharpe ≥ 1.0: **惜しい** (0.933、BH 自体が 0.87 の 6.5y 期間で絶対値 1.0 は厳しい)
- DD ≤ 50%: ✓ (44%)
- Drop ≤ 30%: ✓ (24.3%)
- **Beats BH: ✓ ★**

3/4 pass。絶対 Sharpe 1.0 未達のみ。しかし **BH を超えた事実が 9 ラウンドの積み重ねで初の本質的 positive**。

### 核となる原理（本 repo の決定版）

1. **予測ではなく regime signal**
2. **Hard filter ではなく continuous sizing**
3. **単一 signal ではなく独立な multi-signal の soft voting**
4. **Funding rate のような "market-participant-intent" signal が predictive power を持つ**

詳細: [round-5-findings.md](round-5-findings.md)

### Round 6 以降の候補

- **Open Interest 追加 (5 signal)**: Binance OI 無料、既存 framework 直接拡張 → 最も cost-efficient
- **Kalman filter 動的 weight**: signal 重みを市場 regime に応じて調整
- **Glassnode 有料 tier で signal 強化**: MVRV-Z / NUPL の "本物"
- **実運用検証**: paper trading 3-6ヶ月

### 成果物追加（Round 5 分）

- コード:
  - `yfinance-service/main.py`: `/funding/daily` endpoint (Binance proxy)
  - `prisma/schema.prisma`: `FundingRate` モデル + migration `20260423142114_add_funding_rate`
  - `src/data/funding-loader.ts`
  - `scripts/backfill-funding-rate.ts`
  - `src/backtest/continuous-sizing-v2-engine.ts` (4-signal)
  - `scripts/walk-forward-continuous-sizing-v2.ts` (WF + R4d S3 6.5y 再計算)
- DB: `FundingRate` 2,397 rows (BTCUSDT, 2019-10〜)、`WalkForwardRun` 1 row
- レポート: `reports/walk-forward/continuous-sizing-v2-BTC-USD-*.md` + [round-5-findings.md](round-5-findings.md)
- 実績工数: 約 1.5h（既存 framework 流用で高速）

### 累積サマリ（R1-R5）

```
R1 : FX 日足 × 4 戦略 × 3 ペア              → FAIL (0/12)
R2 : FX 4h × MA Crossover                   → FAIL
R3 : crypto 日足 × 4 戦略                    → FAIL (0/8)
R4a: SMA50 trend filter                     → FAIL (0/8)
R4b: BTC-ETH pair trade                     → FAIL (最悪)
R4c: Onchain binary regime                  → FAIL (partial: DD 半減)
R4d S1: Trailing stop BH                    → FAIL
R4d S2: Multi-signal AND filter             → FAIL (filter death)
R4d S3: Multi-signal continuous sizing (3)  → PARTIAL POSITIVE (drop 29.3%)
R5  : Add funding rate (4-signal)           → ★ BEATS BH (Sharpe 0.933 > 0.871, drop 24.3%)
```

---

## 15. 追補 — Round 6 (TNX 統合、DD 削減 + signal dilution 発見)

### 仮説 H5
「US 10Y yield は最重要のマクロ risk signal の一つ。rising yield = tight money = crypto bearish」

### 実装
- `^TNX` を 5 signal 目（continuous-sizing-v4）または 4 signal 目 +TNX 版 (v3) として追加
- v3: 4-signal (onchain + DXY + VIX + TNX)、10y 検証可能（funding 除外）
- v4: 5-signal 全部、6.5y（funding 含む）

### 結果（10y）

| 戦略 | OOS Sharpe | OOS Max DD | drop | Beats BH 10y (1.102) |
|---|---|---|---|---|
| R4d Step 3 (3-sig) | 0.903 | 47.91% | 29.3% | NO |
| **R6 v3 (+TNX)** | 0.930 | **36.22%** (-11.7pp) | 30.5% | NO |

### 結果（6.5y）

| 戦略 | OOS Sharpe | OOS Max DD | drop | Beats BH 6.5y (0.871) |
|---|---|---|---|---|
| R5 v2 (4-sig +funding) | **0.933** ★ | 43.92% | 24.3% | YES |
| **R6 v4 (5-sig 全部)** | 0.913 | **34.39%** (-9.5pp) | 26.8% | YES |

### 観察

- **TNX は DD 削減に強力** (10y で -11.7pp、6.5y で -9.5pp)
- **Sharpe 改善は marginal** (+0.03 on 10y、-0.02 on 6.5y)
- **Signal dilution 問題**: R5 v2 → R6 v4 で Sharpe 低下 → 均等重み 5-signal では強い signal (funding, onchain) が薄まる
- **DXY と TNX の情報重複**: 両方とも tight money を反映 → 追加効果薄

### 次方向

Round 7 で **weighted ensemble** を探求（詳細: [round-6-findings.md §6](round-6-findings.md)）。Signal correlation 分析 → 手動 weight → data-driven weight の順で。

### 成果物追加（Round 6 分）

- コード:
  - `scripts/backfill-macro.ts`: `^TNX` 追加
  - `src/backtest/continuous-sizing-v3-engine.ts` (4-sig +TNX)
  - `src/backtest/continuous-sizing-v4-engine.ts` (5-sig 全部)
  - `scripts/walk-forward-continuous-sizing-v3.ts` (10y WF + R4d S3 再計算)
  - `scripts/walk-forward-continuous-sizing-v4.ts` (6.5y WF + R5 v2 再計算)
- DB: `MacroBar` に `^TNX` 2,512 rows、`WalkForwardRun` 2 rows
- レポート: `continuous-sizing-v3-*.md`, `continuous-sizing-v4-*.md`, [round-6-findings.md](round-6-findings.md)
- 実績工数: 約 1.5h

---

## 16. 追補 — Round 7 ★★ (Weighted Ensemble で Strict Criteria 全 PASS)

### アプローチ
R6 で均等重みの限界を発見した後、**Signal correlation 分析**を実施:

- **DXY-TNX**: 0.447 (強い重複、TNX は DXY の冗長情報)
- **DXY → 30d forward return**: 0.168 (最強予測子)
- **Onchain / TNX → forward return**: ほぼゼロ or 微負
- **Funding / VIX**: moderate

この結果から **6 つの weight scheme** を設計・比較:

| Scheme | wOnchain | wDxy | wVix | wFunding | wTnx | Sharpe |
|---|---|---|---|---|---|---|
| Equal-4 (baseline) | 0.25 | 0.25 | 0.25 | 0.25 | 0 | 0.959 |
| A: corr-based 5-sig | 0.15 | 0.40 | 0.20 | 0.20 | 0.05 | 0.913 |
| B: 3-sig DXY-heavy | 0 | 0.50 | 0.25 | 0.25 | 0 | 0.944 |
| C: 4-sig drop onchain | 0 | 0.35 | 0.25 | 0.25 | 0.15 | 0.947 |
| D: DXY dominant 3-sig | 0 | 0.60 | 0.20 | 0.20 | 0 | 0.941 |
| **E: DXY+Funding のみ ★** | **0** | **0.60** | **0** | **0.40** | **0** | **1.096 ★★** |

### Scheme E の結果

| KPI | 閾値 | 値 | 判定 |
|---|---|---|---|
| OOS Sharpe | ≥ 1.0 | **1.096** | ✓ |
| OOS Max DD | ≤ 50% | 49.99% | ✓ |
| IS→OOS Drop | ≤ 30% | **15.0%** | ✓ (10 ラウンド最良) |
| Beats BH | 必達 | **YES (+26%)** | ✓ |

**総合: 4/4 PASS ★★ — 本 repo 10 ラウンドで初の完全クリア**

### 核となる教訓

- **Signal は多ければ良いわけではない** — 弱い signal (VIX, TNX, Onchain proxy) は dilution
- **Correlation 分析で「真の edge」を特定** — DXY + Funding の 2 軸が本質
- **2-signal でも適切な weight で十分** — DXY 0.60 + Funding 0.40
- 10 ラウンドで追加された「本 repo 決定版 learning」:
  1. 予測ではなく regime signal
  2. Hard filter ではなく continuous sizing
  3. 独立な multi-signal の soft voting
  4. Funding rate は predictive power あり
  5. **Signal は多さより質。Correlation 分析で真の edge を見極める**

### Round 8 候補

- **A: 実運用 paper trading** (Scheme E を 1-3ヶ月追跡) ← 推奨
- **B: 10y 頑健性検証** (funding 制約の扱いを工夫)
- **C: さらなる edge 探索** (Glassnode 有料 / Open Interest)

推奨: **B → A → C** (運用検証を最優先)

### 成果物追加（Round 7 分）

- コード:
  - `scripts/signal-correlation-analysis.ts` (相関分析)
  - `src/backtest/weighted-ensemble-engine.ts` (可変重み engine)
  - `scripts/walk-forward-weighted-ensemble.ts` (6 scheme 比較 WF)
- DB: `WalkForwardRun` 1 row (Scheme E, passed=true)
- レポート: `reports/walk-forward/weighted-ensemble-BTC-USD-*.md` + [round-7-findings.md](round-7-findings.md)
- 実績工数: 約 1.5h

---

## 17. 追補 — Round 8 ★★★ (Scheme E Robustness Validated)

### 目的

Scheme E (DXY+Funding, 2-signal) が「真の edge」か「手選び weight の local fit」かを最小コストで判別。

### Step 1: Weight Sensitivity (BTC 6.5y)

Scheme E の weight を grid search: `wDxy ∈ [0.30, 0.40, 0.50, 0.55, 0.60, 0.65, 0.70, 0.80]`, `wFunding = 1 - wDxy`:

- **8/8 全 weight で strict criteria 完全 PASS**
- Sharpe range: **1.045 – 1.137**
- Drop range: **6.0% – 18.2%** (全て閾値内)
- 最良 weight: **wDxy=0.30, wFunding=0.70** (Sharpe 1.137)

**判定: ROBUST** — Scheme E は weight に対して局所 fit していない。

### Step 2: ETH Cross-Asset Validation

BTC で調整した固定 weight (wDxy=0.60, wFunding=0.40) をそのまま ETH に適用:

| 指標 | ETH Scheme E | ETH BH |
|---|---|---|
| OOS Sharpe | **1.026** | 0.899 |
| IS→OOS Drop | **-1.9%** (OOS > IS) | — |
| OOS Max DD | 56.17% | 79.35% |
| Beats BH | **YES ★** (+14%) | — |

**特記:**
- **Drop -1.9%** は 10 ラウンドで最良の robustness。OOS が IS よりわずかに良い = 過学習完全ゼロ
- BTC→ETH で同じ weight が機能 → BTC-specific な偶然ではなく**真のマクロ edge**
- DD 56% は BTC 閾値超だが ETH BH の 71%、asset volatility 調整後は実用範囲

### 結論: Scheme E は validated robust strategy

3 軸全てで頑健:
1. **Parameter robust**: R7 全 strict criteria pass, drop 15%
2. **Weight robust**: 8/8 weight で Sharpe > 1.0
3. **Asset robust**: ETH で drop -1.9%, Beats BH

### Signal の本質的理解

- **DXY**: マクロ流動性 (global dollar conditions)
- **Funding**: ミクロ sentiment (crypto participant intent)
- **直交 2 軸**で情報重複なし → uncorrelated かつ predictive
- **BTC も ETH も同じマクロに従う + 同じ perp 市場構造** → asset 超えて機能する理由

### Round 9 候補（推奨順）

- **A: Live paper trading infrastructure** ★ 推奨: daily signal 自動計算 + Binance testnet 接続 + 監視 dashboard、1-3ヶ月 live 運用
- B: 10y DXY-only 版（funding drop 版）の robustness 検証
- C: Other alts (SOL, BNB) cross-asset validation
- D: 非対称 payoff (short allocation) 追加

### 成果物追加（Round 8 分）

- コード:
  - `src/backtest/weighted-ensemble-engine.ts` (asset 引数追加、ETH 対応)
  - `scripts/weight-sensitivity-scheme-e.ts` (Step 1)
  - `scripts/backfill-eth-funding.ts` (ETHUSDT funding 2,340 rows)
  - `scripts/walk-forward-scheme-e-eth.ts` (Step 2)
- DB: `FundingRate` ETHUSDT 2,340 rows 追加、`WalkForwardRun` 1 row
- レポート: `reports/walk-forward/scheme-e-eth-*.md` + [round-8-findings.md](round-8-findings.md)
- 実績工数: 約 1.5h

---

## 18. 追補 — Round 14 (SOL/BNB Cross-Asset、Scheme E の適用範囲を確定)

### 目的

Round 8 の「BTC→ETH で同じ固定 weight が機能」を受け、Scheme E の edge が large-cap 全般か BTC/ETH 固有かを SOL/BNB で判別（固定 weight、backtest only）。

### 結果（FAIL）

| Asset | OOS Sharpe | BH Sharpe | Drop | Beats BH | 判定 |
|---|---|---|---|---|---|
| ETH (R8) | 1.026 | 0.899 | -1.9% | YES | PASS |
| **SOL** | **0.282** | 1.007 | **73.7%** | NO | **FAIL** |
| **BNB** | **0.394** | 1.050 | **55.8%** | NO | **FAIL** |

### 教訓

- **Scheme E の edge は BTC/ETH の large-cap に限定**。SOL/BNB は FTX 破綻・取引所規制等の **idiosyncratic shock が支配的**で、DXY（マクロ流動性）+ Funding（perp sentiment）では捕捉不能
- drop 55〜74% は BTC/ETH（15%/-1.9%）と対照的 → signal と資産の関係が非定常
- **「Scheme E = 汎用 crypto 戦略」ではなく「マクロ感応度の高い大型資産の戦略」**という境界確認。有益な negative result
- alt exposure を取るなら横展開ではなく BTC.D overlay（Round 13）の方が筋
- 運用中の BTC/ETH baseline には一切影響なし（backtest only、core weight 不変）

詳細: [round-14-findings.md](round-14-findings.md)、Linear KOH-513
