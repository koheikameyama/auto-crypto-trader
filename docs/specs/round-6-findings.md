# Round 6 Findings — US 10Y Yield (TNX) 統合

**実施日:** 2026-04-23
**結論:** **TNX は DD 削減に強力 (10y: 48%→36%) だが Sharpe 改善は marginal**。均等重み 5-signal の限界を観測 → 次ラウンドで weighted ensemble が必要。

---

## 1. 結果サマリ

### 10y full period（v3: 4-signal onchain + DXY + VIX + TNX、funding 除外）

| 戦略 | OOS Sharpe | OOS Max DD | IS→OOS Drop | Beats BH 10y |
|---|---|---|---|---|
| BH 10y | 1.102 | 83.40% | — | — |
| R4d S3 (3-signal) | 0.903 | 47.91% | 29.3% | NO |
| **R6 v3 (+TNX)** | **0.930** (+0.027) | **36.22%** (−11.7pp) | 30.5% | NO |

### 6.5y funding-available period（v4: 5-signal 全部）

| 戦略 | OOS Sharpe | OOS Max DD | IS→OOS Drop | Beats BH 6.5y |
|---|---|---|---|---|
| BH 6.5y | 0.871 | 76.63% | — | — |
| R5 v2 (4-signal +funding) | **0.933** ★ | 43.92% | 24.3% | **YES** |
| **R6 v4 (5-signal)** | 0.913 (−0.020) | **34.39%** (−9.5pp) | 26.8% | **YES** |

---

## 2. TNX の寄与分析

### Positive

- **DD 削減効果が明確**: 両期間で Max DD を **9-12 pp 削減**
  - 10y: 47.91% → 36.22% (−11.7 pp)
  - 6.5y: 43.92% → 34.39% (−9.5 pp)
- **Bear regime 検知に優れる**: 2022 年の crypto 下落（10Y yield 急上昇と同時進行）を正確に捉えた結果、position 縮小に成功

### Negative

- **Sharpe 改善が marginal**: +0.03 (10y) / −0.02 (6.5y)
- **TNX と DXY の情報重複**: 両方とも「tight monetary conditions」を反映。独立性が低い → 均等重みで足しても新規情報が少ない
- **Signal 数が増えすぎると diluting**: 5-signal では各 signal の重み 0.20、単一誤検知への頑健性は上がるが、強い signal の寄与が薄まる

---

## 3. 過学習 drop の推移

| Round | Drop |
|---|---|
| R4d S3 | 29.3% |
| R5 v2 | **24.3%** (最良) |
| R6 v3 | 30.5% |
| R6 v4 | 26.8% |

TNX 追加で drop は若干悪化（R5 v2 → R6 v4）。4 signal → 5 signal で过学習耐性が低下した可能性。**これは「signal は多いほど良い」仮説を否定**。

---

## 4. Strict Criteria

### 10y (v3)
| KPI | 閾値 | v3 | 判定 |
|---|---|---|---|
| OOS Sharpe | ≥ 1.0 | 0.930 | ✗ |
| OOS Max DD | ≤ 50% | 36.22% | ✓ (大幅クリア) |
| IS→OOS Drop | ≤ 30% | 30.5% | ✗ (ギリギリ) |
| Beats BH | 必達 | NO (0.930 < 1.102) | ✗ |

**総合: FAIL** (Sharpe 1.0 未達 & BH 超えず)

### 6.5y (v4)
| KPI | 閾値 | v4 | 判定 |
|---|---|---|---|
| OOS Sharpe | ≥ 1.0 | 0.913 | ✗ |
| OOS Max DD | ≤ 50% | 34.39% | ✓ (大幅クリア) |
| IS→OOS Drop | ≤ 30% | 26.8% | ✓ |
| Beats BH | 必達 | **YES (0.913 > 0.871)** | ✓ ★ |

**総合: 3/4 PASS、Sharpe 1.0 未達のみ**。R5 v2 と同じ結果パターン。

---

## 5. Signal Ensemble の課題

R4d → R5 → R6 の Sharpe 推移:

| Round | Signals | 10y Sharpe | 6.5y Sharpe |
|---|---|---|---|
| R4d S3 | 3 (onchain, DXY, VIX) | 0.903 | 0.747 |
| R5 v2 | 4 (+funding) | — | **0.933** |
| R6 v3 | 4 (+TNX, no funding) | **0.930** | — |
| R6 v4 | 5 (+funding, +TNX) | — | 0.913 |

**均等重みの限界が見えた**:
- R5 v2 → R6 v4 で Sharpe が下がる（funding + TNX の重み合計 0.40 ほど、他の signal が薄まる）
- R4d S3 → R6 v3 で Sharpe +0.03 のみ（TNX と DXY の情報重複）

### 次の方向性

**Weighted ensemble** が必要:
1. **手動 weight**: 強い signal (funding, onchain) を 0.3、弱い signal (DXY, VIX, TNX) を 0.1-0.15 など
2. **Data-driven weight**: 各 signal の IS Sharpe contribution から重みを算出（ただし過学習リスク）
3. **Signal 選択**: 相関が強い DXY と TNX のどちらか一方を drop
4. **動的 weight**: 市場 regime により weight を動的調整（Kalman filter ベース）

---

## 6. 次ラウンド (Round 7) 推奨

### A. Signal correlation 分析

- DXY / VIX / TNX / funding / onchain の各 signal score 間の相関を計算
- 相関 > 0.7 の signal pair から片方を drop、独立性を確保

### B. Weighted ensemble 実験

- 手動で weight を変えて grid search（例: [0.3, 0.2, 0.2, 0.15, 0.15]）
- 過学習リスクを抑えるため weight 候補は少なめ (5-10 combos)

### C. Onchain signal 強化（Glassnode paid 検討）

- 無料 Community API の MVRV proxy は現在の onchain score の下限
- Glassnode Pro ($29/月) で本物の MVRV-Z / NUPL / Puell Multiple 取得
- Onchain signal の精度向上で Sharpe 底上げ期待

推奨順序: **A → B → C**。A は即時実行可能で情報が得られる。B は engine 1 つで済む。C は課金判断。

---

## 7. 成果物

- コード:
  - `yfinance-service/main.py`: 既存 `/macro/daily` で TNX 対応
  - `scripts/backfill-macro.ts`: TICKERS に `^TNX` 追加
  - `src/backtest/continuous-sizing-v3-engine.ts` (4-signal +TNX)
  - `src/backtest/continuous-sizing-v4-engine.ts` (5-signal)
  - `scripts/walk-forward-continuous-sizing-v3.ts` (10y WF)
  - `scripts/walk-forward-continuous-sizing-v4.ts` (6.5y WF)
- DB: MacroBar に `^TNX` 2,512 rows、`WalkForwardRun` 2 rows
- レポート: `reports/walk-forward/continuous-sizing-v3-*.md`、`continuous-sizing-v4-*.md`
- 実績工数: 約 1.5h（期待通り、既存 framework 流用で高速）

---

## 8. 累積（R1-R6）

```
R1-R4b: 予測ベース戦略 → 全滅
R4c   : Onchain binary regime → DD 半減 (partial positive)
R4d S3: 3-signal continuous sizing → 過学習構造的突破 (drop 29.3%)
R5 v2 : 4-signal (+funding) → ★ 初の Beats BH (Sharpe 0.933 vs 0.871)
R6 v3 : 4-signal (+TNX, 10y) → DD 大幅削減 48%→36%、Sharpe +0.03 (marginal)
R6 v4 : 5-signal (+funding +TNX) → DD 44%→34%、Sharpe 0.933→0.913 (signal dilution)
```

### 本質的 learning

- 最良の結果は **R5 v2 (6.5y Sharpe 0.933)** と **R6 v3 (10y Sharpe 0.930)** で拮抗
- 両方とも Sharpe 1.0 未達、BH 10y (1.102) 未達、BH 6.5y (0.871) は超える
- **均等重み ensemble の限界に達した** → 次は weight 調整 or signal 強化が必須

### 現実的な運用候補

R5 v2 (6.5y) or R6 v3 (10y) を baseline として運用開始する選択肢:
- Sharpe 0.93、DD 36-44%
- BH に勝ってはいないが "risk-managed BH" として価値あり
- 心理的に BH (DD 83%) より保持しやすい

---

## 9. まとめ

TNX は**DD 削減には強力な signal**だが、Sharpe 改善は Round 5 の funding rate 追加ほど劇的ではなかった。5 signal 均等重みは dilution を招き、Sharpe が若干低下した。

**次は weighted ensemble と signal correlation 分析で「最強の 3-4 signal 組合せ」を探す**べき。本 repo の research story としては Round 5 の Sharpe 0.933 がピーク、Round 6 で DD 改善を追加、Round 7 で weight 最適化という自然な進化路。
