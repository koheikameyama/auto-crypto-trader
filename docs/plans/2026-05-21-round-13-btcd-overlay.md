# Round 13 — BTC.D Regime Overlay（alt-season を Scheme E に組み込む）

**作成日:** 2026-05-21
**前提:** Round 7/8 で確立した Scheme E (DXY 0.60 + Funding 0.40) の core weight は変更しない。本 Round は **asset 間配分の overlay** として BTC.D を追加するか否かを検証する
**動機:** 草コイン追加の議論を契機に、「alt exposure を取るなら新戦略ではなく既存戦略の overlay として BTC.D regime filter を入れるのがプロ的に筋」と判断（2026-05-21 user との議論）

---

## 1. 問題と目標

### 観測されている問題

- 現状 Scheme E は BTC/ETH を **完全独立に** 運用（各 asset 内で DXY+Funding signal を計算し target position を出す）
- BTC.D（BTC dominance）のレジーム情報を一切使っていない
- alt-season（BTC.D が下降する局面）で ETH が BTC を outperform するという crypto market の経験則を捕捉できていない

### 目標

| 指標 | Scheme E baseline (Round 7/8) | Round 13 目標 |
|---|---|---|
| OOS Sharpe (BTC/ETH combined, 10y WF) | 1.10 ※ | **≥ 1.15** |
| OOS Max DD | 49.99% | **≤ 50%** |
| IS→OOS Drop | 15.0% | **≤ 30%** |
| Beats BH (BTC equal-weight + ETH equal-weight) | YES | **YES（必達）** |

※ Round 7 は BTC 単体 6.5y、Round 8 で ETH 含め 10y robustness 確認済（参照: [round-8-findings.md](../specs/round-8-findings.md)）

### Sharpe 寄与の事前見立て

- alt-season は概ね 2017-Q4、2021-Q1、2024-Q1 などに発生
- 該当期間で BTC weight を 30〜50% 程度 ETH に振り替えた場合、ETH の outperform を取れれば年率 +50〜200 bps の寄与
- 一方、誤判定（BTC.D 下降 ≠ ETH outperform）の局面では BTC loss + ETH 同等で **目減りリスク**
- **正味の改善幅は小さい可能性が高い** ことを最初に明記。Sharpe +0.05 を超えなければ採用しない

---

## 2. 仮説

| # | 仮説 | 検証方法 |
|---|---|---|
| H1 | BTC.D < SMA200 の局面では ETH > BTC | 該当期間の BTC/ETH return spread を計算 |
| H2 | 単純な BTC.D SMA cross (50/200) で alt-season 入り口を捕捉できる | cross シグナルと ETH/BTC ratio の相関 |
| H3 | BTC.D を Scheme E に 3つ目の signal として追加（asset 配分 overlay）すると Sharpe 改善 | walk-forward で V0 vs V1, V2 比較 |
| H4 | overlay の効果は ETH 側にのみ現れる（BTC 単体 Sharpe は変化なし or 微減） | asset 別 Sharpe 分解 |

---

## 3. 検証する戦略バリアント

### V0 — baseline（既存 Scheme E、独立運用）

- BTC: DXY 0.60 + Funding 0.40
- ETH: DXY 0.60 + Funding 0.40（funding は ETHUSDT perp）
- 両 asset の equity を 50/50 で固定配分

### V1 — BTC.D regime hard overlay

- baseline 計算後、`BTC.D < EMA(BTC.D, 200)` の日は **BTC target position の 30% を ETH に振り替え**
- それ以外は 50/50
- 振替比率 30% は事前 fix（過学習回避）。WF で 20%/30%/40% を比較するが in-sample 最適化はしない

### V2 — BTC.D continuous overlay

- `score_btcd = -1 × zscore(BTC.D, 365)` を計算（BTC.D が低い → score 正 → ETH overweight）
- ETH weight = `clamp(0.5 + 0.2 × tanh(score_btcd), 0.3, 0.7)`
- BTC weight = `1 - ETH weight`
- 連続的に振り替えるので rebalance 頻度が上がる懸念 → fee の影響を別途集計

### V3 — BTC.D を 3rd signal として ensemble に追加（参考）

- Scheme E の DXY+Funding に BTC.D signal を加えて wDxy=0.50, wFunding=0.35, wBtcD=0.15 で trial
- **これは Scheme E の core weight を触る** ので forbidden #1 抵触の懸念。原則として scope outだが、V1/V2 が無効だった場合の参考として 1 run のみ実施

---

## 4. 前提データ — **本 Round 最大のブロッカー**

### 現状

- BTC.D は [scripts/daily-data-collection.ts:143](../../scripts/daily-data-collection.ts#L143) で **daily 収集のみ**
- DB の `MacroBar` 上、過去データ無し（daily-data-collection.ts が稼働開始した時点以降のみ）

### 必要

- **2014-01-01 〜 現在の BTC.D 日次データ** が必要（Scheme E と同じ 10y backtest 期間）
- 候補ソース:
  - CoinGecko `/global` historical API（free tier では historical 不可、Pro tier $129/mo）
  - CoinMarketCap historical API（有料）
  - TradingView CRYPTOCAP:BTC.D の CSV export（手動 1 回）★ 推奨
  - 自前計算: BTC market cap ÷ total crypto market cap（要 historical market cap データ）

### Action

- **Phase A**: TradingView から CRYPTOCAP:BTC.D の daily CSV を export
- `scripts/backfill-btc-dominance.ts` を新規作成、CSV を `MacroBar` (ticker="BTC.D") に UPSERT
- backfill 完了するまで Phase B (backtest) は開始不可

---

## 5. 実装

### 新規

- `scripts/backfill-btc-dominance.ts` — TradingView CSV → MacroBar UPSERT
- `src/backtest/btcd-overlay-engine.ts` — Scheme E 結果を入力に、BTC.D overlay を適用する layer
  - V1 (hard) / V2 (continuous) を切替可能な設計
  - 既存 `weighted-ensemble-engine.ts` の結果を後段で混合する（core engine は触らない）
- `scripts/walk-forward-btcd-overlay.ts` — V0/V1/V2 を 10y WF で比較
- `scripts/analyze-btcd-altseason.ts` — H1/H2 の単純相関分析（実装前に edge の存在を確認）

### 既存利用

- `src/backtest/weighted-ensemble-engine.ts` — そのまま（変更しない）
- `src/live/signal-computer.ts` — V1/V2 が PASS した場合のみ後 Round で live 統合（本 Round では触らない）
- `MacroBar` schema — そのまま、ticker="BTC.D" の row を追加するだけ

---

## 6. 安全策

- **Scheme E の core weight (wDxy=0.60, wFunding=0.40) を変更しない**（forbidden #1）
- **Live 実行系（signal-computer.ts, execution-adapter.ts）に一切触らない** — 本 Round は backtest only
- **Phase 2.2 Small (¥100,000) と完全に分離** — virtual/actual ledger を汚染しない
- BTC.D backfill は **CSV を git commit せず**（容量・ライセンス）、scripts のみ commit。CSV は `data/btc-dominance.csv` に置き .gitignore
- **V3 (core weight 変更) は scope out が原則**。実施する場合も別ファイル別 run で記録、findings に明示

---

## 7. 完了条件

- [ ] BTC.D historical data backfill 完了（2014-01-01 〜 現在、欠損 < 5%）
- [ ] H1/H2 の事前相関分析レポート（edge の存在確認、無ければ V1/V2 実装中止）
- [ ] V0/V1/V2 の 10y walk-forward 結果
- [ ] asset 別 Sharpe 分解（BTC 単体・ETH 単体・combined）
- [ ] 振替比率 sensitivity（V1: 20/30/40%）
- [ ] Round 13 findings doc 作成
- [ ] 採否判断: Sharpe 改善 ≥ +0.05 かつ DD 悪化なしなら採用候補。それ以外は不採用で確定（live 統合は別 Round）

---

## 8. スコープ外

- 草コイン追加（本 Round の動機ではあるが、対象 asset は BTC/ETH のみ）
- Scheme E core weight 変更（V3 は参考のみ）
- Live execution への統合（PASS したら別 Round で live 統合を計画）
- 新取引所追加、新 signal 探索（BTC.D 以外）
- ETH 単体での独自 signal 開発（ETHUSDT funding は既に Scheme E に組込済）

---

## 9. タイムボックス

| Phase | 内容 | 見積 |
|---|---|---|
| A | BTC.D historical backfill（TradingView export + UPSERT script） | 2 時間 |
| B | H1/H2 事前相関分析（edge の存在確認） | 1 時間 |
| C | V1/V2 engine 実装 + walk-forward script | 3 時間 |
| D | 10y WF 実行 + 集計 | 1〜2 日（実行時間） |
| E | findings doc + 採否判断 | 1 時間 |
| **合計** | | **~7 時間 + 1〜2 日** |

Due 目処: 2026-06-05（Phase 2.2 Small の judgement 2026-06-12 より前に結論を出す）

---

## 10. リスク

| リスク | 影響 | Mitigation |
|---|---|---|
| BTC.D historical データが取れない / 信頼性低い | Round 中止 | TradingView, CoinGecko Pro trial, 自前計算の 3 案を持つ。最悪 6.5y で妥協 |
| H1/H2 で edge が確認できない | V1/V2 実装を中止して Round 終了 | Phase B で早期判断、無駄な実装を防ぐ |
| V1/V2 で Sharpe 改善 < +0.05 | 採用見送り | findings に「BTC.D overlay は無効」と記録、Scheme E 単独で運用継続 |
| Rebalance 頻度増加で fee が改善幅を食う | Sharpe 寄与が見かけより小さい | Round 12 の実測 effective fee（taker +7.9 bps, maker -5 bps）を cost model に反映 |
| backtest 結果が良くても live で同じ結果が出ない | Phase 2 baseline 崩壊 | live 統合は別 Round、まず paper trading で 1-3 ヶ月追跡 |
| 「ついで」で他の改善も同時に試したくなる | forbidden #7 抵触 | 本 Round の scope は **BTC.D overlay のみ**。signal 追加・閾値変更は次 Round |

---

## 11. 関連

- 議論起点: 2026-05-21 user との会話（「草コインを買う戦略ある？」→「BTC.D regime overlay が筋」）
- 前提: [round-7-findings.md](../specs/round-7-findings.md), [round-8-findings.md](../specs/round-8-findings.md)
- 影響を受けない: Phase 2.2 Small ([2026-05-12-phase-2-2-small.md](2026-05-12-phase-2-2-small.md)) は継続
- Linear: 本 plan が承認されたら KOH-XXX を発行（user 側で起票）
