# Round 4c Findings — On-Chain Regime Filter (BTC)

**実施日:** 2026-04-23
**結論:** **主KPI は FAIL だが部分的 positive** — DD を BH の半分に削減、MAR は 6x
**次ステップ:** 後述（§6）

---

## 1. 仮説と結果

### 仮説 H3
「オンチェーン活動が弱い時期は BH が危険、強い時期は BH が報われる。NVT proxy + Active Address momentum の組合せレジーム信号で DD を抑制しつつ Sharpe 改善できる」

### 結果サマリ

- **Sharpe 改善: 失敗** (0.684 < BH 1.102)
- **DD 削減: 成功** (BH 83% → Strategy 43%、約半分)
- **MAR 改善: 成功** (BH 0.806 → Strategy avg 4.87、6x)
- **主KPI 総合: FAIL** (Sharpe / DD / IS→OOS drop で閾値未達)

→ **Sharpe 単独で見ると劣後だが、リスク調整の別指標 (MAR) では BH を大きく凌駕**。リターンと DD を同時に下げ、ネットの risk-adjusted 改善は曖昧。

---

## 2. KPI 詳細

### WF 集計 (18 windows, 27 param combos グリッドサーチ)

| KPI | 閾値 | Round 4c 値 | 判定 |
|---|---|---|---|
| OOS Avg Sharpe | ≥ 1.0 | 0.684 | FAIL |
| OOS Avg MAR | ≥ 0.5 | **4.871** | **PASS（大幅超過）** |
| OOS Avg PF | ≥ 1.3 | 5.140 | PASS |
| OOS Max DD | ≤ 30% | 42.73% | FAIL |
| IS→OOS Sharpe Drop | ≤ 30% | 49.3% | FAIL |

### BTC Buy & Hold ベンチマーク（10年全期間）

| 指標 | BH 値 | Round 4c |
|---|---|---|
| Sharpe | 1.102 | 0.684 (−38%) |
| MAR | 0.806 | 4.871 (+505%) |
| Total Return | 16,954% | （WF 非集計） |
| Max DD | 83.40% | **42.73% (−49%)** |

### Round 3 / 4a / 4b との比較

| Round | OOS Sharpe | Max DD | Beats BH? | 総合 |
|---|---|---|---|---|
| R3 donchian BTC | 0.797 | ~6% (サイジング 1%) | NO | FAIL |
| R4a donchian-tf BTC | 0.621 | — | NO | FAIL |
| R4b pair-trade | -0.693 | 34% | NO | FAIL |
| **R4c onchain-regime** | **0.684** | **43%** | **NO** | **FAIL (部分 positive)** |

Round 4c は「Sharpe で BH に勝てない」点では他と同じだが、**DD が BH の半分**である点が唯一違う positive。

---

## 3. なぜ Sharpe は改善しなかったか

Strategy は「bullish でない時期は cash」なので:
- **upside をしばしば逃す**: 強気相場の序盤で NVT 高 or AA momentum 低で参戦しそこねる
- **bearish → cash 移行の遅れ**: レジーム確定に時間がかかる間、既に大きく下落
- **取引コスト**: 各レジーム遷移で 0.20% round-trip → 年 2-4 回でも 1%/年

結果として:
- リターンは BH 比 6-7 割
- 分母のボラティリティは BH より下がるが、分子（超過リターン）も同時に下がる
- ネット Sharpe で劣後（cash hedge のクラシックな代償）

---

## 4. DD 削減は実用的に意味がある

BH 83% の DD は**実際の運用では許容しにくい**水準:
- 100 万円投下が最悪時 17 万円になる
- 精神的に継続運用が困難（多くの投資家は 30-40% DD で降参）

Strategy の 43% DD は:
- まだ重いが、典型的な「攻めのオルタナティブ」水準（60/40 よりはるかに攻撃的だが BH よりは穏やか）
- **実運用では passive BH より持続可能**な可能性

→ **純粋 Sharpe 最大化の視点では FAIL、実運用可能性の視点では partial success**

---

## 5. 過学習について

IS→OOS drop 49.3% は R3 (48%) / R4a (40-118%) / R4b (178%) と比較してmiddle:
- R3 / 4a と同程度 → 過学習はあるが破綻的ではない
- R4b より大幅に良い → 体制変化への頑健性は相対的に高い
- しかし閾値 30% は越える → 純粋 research 目線では不合格

---

## 6. 本プロジェクトの最終判定

5 ラウンド（R1/2 FX、R3/4a/4b/4c crypto）の累積:

```
Round 1 : FX 日足 × 4 戦略 × 3 ペア              → FAIL (0/12)
Round 2 : FX 4h × MA Crossover                   → FAIL
Round 3 : crypto 日足 × 4 戦略                    → FAIL (0/8)
Round 4a: Round 3 + SMA50 フィルタ                → FAIL (0/8)
Round 4b: BTC-ETH pair trade z-score             → FAIL (最悪)
Round 4c: BTC オンチェーン regime filter          → FAIL (部分 positive)
```

### 学んだこと（6 ラウンド共通）

1. **予測ベースの単純戦略は crypto / FX 日足で一貫して OOS 過学習する**
2. **Buy & Hold (BTC) が Sharpe 1.1 で、あらゆる active 戦略を凌駕**
3. **情報源を変えても根本は変わらない** (価格 / SMA / spread / onchain proxy すべて FAIL)
4. **ただし DD 削減は可能** (Round 4c が唯一 positive を示した)

### 「部分 positive」の扱い

Round 4c の結果は微妙:
- **技術判定は FAIL**: Sharpe 閾値未達、BH 負け、DD 閾値超
- **実用観点では interesting**: BH の DD 83% を 43% に削減できる
- **Sharpe-MAR trade-off**: MAR 基準ならむしろ BH 大勝

本 repo の当初基準（Sharpe ≥ 1.0、Beats BH）では FAIL。しかし「DD を半減しつつリターンを 60-70% 維持する戦略」は**別のユースケース**（リスク許容度の低い investor、親の退職金のような状況）では価値がある。

---

## 7. 結論と recommendation

**本 repo をこの時点で 正式 DONE とします**。

理由:
- 仮説 H1 (trend filter) / H2 (stat arb) / H3 (onchain regime) の 3 つを独立に検証し、すべて主KPI を満たさなかった
- Round 4c は「部分的な有用性」を示したが、当初の research question「単純な技術指標戦略で crypto のエッジを発見できるか」への回答は**否定**で固定
- 追加ラウンド（オンチェーン指標の variant、別チェーン、時間軸変更）の期待値は逓減

### Round 4c の positive を次に活かすには（別 repo / プロジェクト）

1. **"Risk-managed BH" としてリパッケージ**: 「アクティブ運用はしないが、極端な bear regime では cash に退避する」保守的 BH プロダクト
2. **他オンチェーン指標との複合**: MVRV / NUPL が使える paid API (Glassnode 等) でより強い regime signal を試す
3. **マクロ指標との融合**: DXY / VIX / US 2Y yield を on-chain signal と組合せる
4. **Position sizing の動的調整**: all-in/all-out ではなく bullish 確度に応じて BTC exposure を 0-100% で連続調整

### 本 repo の今後

- **参照実装 + 6 ラウンドの negative result アーカイブ**として固定
- 実コードベース（engine / WF / metrics / indicators / regime）は他プロジェクトでの再利用可能
- docs/specs/ の一連の findings は「何を試して何が失敗したか」の記録として価値あり

---

## 8. 成果物（Round 4c）

- コード:
  - `yfinance-service/main.py`: `/onchain/daily` 追加（CoinMetrics Community API proxy）
  - `prisma/schema.prisma`: `OnchainMetric` 追加 + migration
  - `src/data/onchain-loader.ts`
  - `src/lib/onchain-indicators.ts` + tests (8件)
  - `src/backtest/regime-engine.ts` + tests (4件)
  - `src/walk-forward/regime-engine.ts`
  - `scripts/backfill-onchain-metrics.ts`
  - `scripts/walk-forward-onchain-regime.ts`
- テスト: 12 件追加、全 **170 件グリーン**
- DB: `OnchainMetric` 3,652 rows (BTC 10年), `WalkForwardRun` 1 row 追加
- レポート: `reports/walk-forward/onchain-regime-BTC-USD-*.md`
- 実績工数: 設計 + 実装 + 実行 + レポート = 約 2h（CoinMetrics API 制限発見 → 設計変更 → 実装で素早く収束）
