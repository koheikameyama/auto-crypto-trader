# Auto Crypto Trader — Research Findings

**実験実施日:** 2026-04-23
**結論:** **完全 FAIL**。単純な技術的戦略は crypto でも機能しないことが確定。
**データ:** BTC-USD 3,652 bars（10年）、ETH-USD 3,087 bars（約8.5年）。yfinance 経由、日足、UTC。

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
