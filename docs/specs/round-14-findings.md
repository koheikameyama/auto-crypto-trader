# Round 14 Findings — SOL/BNB Cross-Asset Validation（Scheme E は BTC/ETH 限定）

**実施日:** 2026-07-04
**結論:** **SOL/BNB とも FAIL。** Scheme E (DXY 0.60 + Funding 0.40) の edge は BTC/ETH の large-cap に限定され、SOL/BNB には汎化しない
**教訓:** **「マクロ edge は資産のマクロ感応度に依存する」** — SOL/BNB は idiosyncratic shock（FTX 破綻・取引所規制等）が支配的で、DXY+Funding では捕捉できない

---

## 1. 目的

Round 8 で「BTC→ETH で同じ固定 weight が機能 = 真のマクロ edge」と確認した。この edge が large-cap 全般に効くのか、BTC/ETH 固有なのかを SOL/BNB で判別する。**core weight は変更せず**（固定 wDxy=0.60, wFunding=0.40）、in-sample では hyper（dxySmaPeriod, rebalanceThreshold）のみ選択。

---

## 2. 結果

| Asset | Windows | OOS Sharpe | OOS MAR | OOS Max DD | IS→OOS Drop | BH Sharpe | Beats BH | 判定 |
|---|---|---|---|---|---|---|---|---|
| ETH (R8 参照) | — | **1.026** | — | 56.17% | **-1.9%** | 0.899 | **YES** | PASS |
| **SOL-USD** | 9 | **0.282** | 1.506 | 68.59% | **73.7%** | 1.007 | **NO** | **FAIL** |
| **BNB-USD** | 10 | **0.394** | 0.773 | 43.60% | **55.8%** | 1.050 | **NO** | **FAIL** |

- **期間:** SOL 2020-09〜2026-07（~5.8y、9 windows）、BNB 2020-02〜2026-07（~6.4y、10 windows）
- **データ:** SOL 価格 2133 / SOLUSDT funding 2121、BNB 価格 2346 / BNBUSDT funding 2337、DXY 共有
- レポート: `reports/walk-forward/scheme-e-sol-20260704-105720.md`, `scheme-e-bnb-20260704-105738.md`

### 判定

- **Strict criteria (Sharpe ≥ 1.0 & DD ≤ 50% & drop ≤ 30% & Beats BH): 両方 FAIL**
- **Weak criteria (Sharpe ≥ 0.9 & Beats BH & drop ≤ 30%): 両方 FAIL**
- Beats BH すら達成できず、drop も 55〜74% と過学習レベル

---

## 3. なぜ SOL/BNB では効かないか

| 要因 | 説明 |
|---|---|
| **Idiosyncratic shock 支配** | SOL は FTX/Alameda 破綻（2022-11）で -96% 級の暴落、BNB は Binance 規制リスク。これらは DXY（マクロ流動性）でも Funding（perp sentiment）でも予測できない資産固有イベント |
| **BH が極端に強い** | SOL BH Sharpe 1.007（TR +1787%）、BNB BH 1.050（TR +3026%）。爆発的な単純保有リターンに対し、regime sizing で downside を避けると upside も取り逃す |
| **Drop 55〜74%** | IS で選ばれた hyper が OOS で全く維持されない = signal と資産の関係が非定常。BTC/ETH の drop（15%/-1.9%）と対照的 |
| **マクロ感応度の差** | BTC/ETH は「デジタルゴールド／ETH beta」としてマクロ流動性に連動。SOL/BNB は narrative/ecosystem 主導で、マクロとの連動が弱い |

---

## 4. 結論と採否判断

**採否: 不採用（confirmed）。** Scheme E を SOL/BNB に展開しない。

- Scheme E の validated edge は **BTC/ETH の large-cap 2 資産に限定**される
- これは negative だが**有益な境界確認**: 「Scheme E = 汎用 crypto 戦略」ではなく「マクロ感応度の高い大型資産に効く戦略」だと明確化
- **live 統合はしない**（もともと backtest only scope）。GMO 発注対象は BTC（+ 将来 ETH）のまま
- Round 8 の BTC/ETH robustness は無傷。本 Round は運用中の baseline に一切影響なし

### Scheme E の適用範囲（更新後の理解）

```
効く:    BTC-USD (Sharpe 1.10, drop 15%), ETH-USD (Sharpe 1.03, drop -1.9%)
効かない: SOL-USD (Sharpe 0.28, drop 74%), BNB-USD (Sharpe 0.39, drop 56%)
境界:    マクロ流動性連動が強い large-cap のみ。alt/narrative 系は idiosyncratic shock が支配的
```

---

## 5. 次への示唆

- **alt exposure を取りたいなら Scheme E の横展開ではない**アプローチが必要（Round 13 BTC.D overlay の方が筋 — BTC/ETH 内での配分調整）
- SOL/BNB を予測する固有 signal（ecosystem TVL、narrative flow 等）は本 repo の scope 外
- 大型 alt が今後 BTC 化（マクロ連動が強まる）すれば再検証の余地あり。ただし現時点では明確に FAIL

---

## 6. 成果物

- コード:
  - `src/types/asset.ts` / `src/data/asset-config.ts` / `src/data/price-loader.ts` — SOL-USD/BNB-USD 追加（live 非汚染）
  - `scripts/backfill-alt-funding.ts` — 汎用 funding backfill
  - `scripts/walk-forward-scheme-e.ts` — asset 汎用 cross-asset WF
- DB: `DailyBar` SOL 2154 + BNB 3163、`FundingRate` SOLUSDT 2121 + BNBUSDT 2337、`WalkForwardRun` 2 rows（passed=false）
- Plan: [docs/plans/2026-07-04-round-14-sol-bnb-cross-asset.md](../plans/2026-07-04-round-14-sol-bnb-cross-asset.md)
- Linear: KOH-513
