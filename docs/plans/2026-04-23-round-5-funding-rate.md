# Round 5: Funding Rate 統合

**作成日:** 2026-04-23
**前提:** Round 4d Step 3 で IS→OOS drop 29.3%、Sharpe 0.903（BH 1.102 の 82%）を達成。BH 超えには追加 signal が必要。
**目的:** Binance BTCUSDT perp の funding rate を 4 つ目の signal として追加し、Sharpe ≥ 1.0 or BH 超えを狙う。
**想定工数:** 2-3 時間

---

## 1. 仮説

**H4「Funding rate は最も純粋な sentiment 指標」:**
- BTCUSDT perp funding rate は「現在の long ポジション需要 - short ポジション需要」を直接反映
- 高 funding = longs が多すぎ = 過熱 = bearish 先行指標
- 低/負 funding = shorts が多すぎ = capitulation = bullish 先行指標
- Onchain (NVT/AA) や Macro (DXY/VIX) は間接指標だが、funding は**市場参加者の意思を直接測定**

→ 4 つ目の signal として Step 3 の continuous sizing に足せば、BH 超えの Sharpe が狙える可能性あり

---

## 2. データソース

### Binance Futures Public API

- **エンドポイント**: `GET https://fapi.binance.com/fapi/v1/fundingRate`
- **認証不要**、レート制限緩い（IP 1200/min）
- **パラメータ**: `symbol=BTCUSDT&limit=1000&startTime=<ms>`
- **レスポンス**: `[{ symbol, fundingTime (ms), fundingRate (string) }]`
- **間隔**: 8 時間ごと（= 日 3 回）、平均 0.01% / 支払いインターバル
- **履歴**: 2019-09 以降（BTCUSDT perp ローンチ以降）→ **約 6.5 年分**

### 制約

- Round 4d は 10 年 WF、Round 5 は **6.5 年にスコープ縮小**（2019-10-01 以降）
- → Round 4d Step 3 と直接比較できないため、**Step 3 を 6.5 年 window で再実行して比較ベースラインを作る**

---

## 3. 戦略仕様

### Signal の設計

1. 各日の funding rate を集計: `dailyFunding = mean(3 funding rates per day)` を採用（UTC 日単位）
2. **Rolling percentile** で regime 判定（固定閾値だと時代による funding 水準の違いに適応できない）
3. Score 計算:
   - `fundingPercentile = trailing_365d rolling percentile of dailyFunding`
   - `fundingScore = 1 - fundingPercentile` （低 funding = bullish = score 高）
4. Final position = `(onchain + dxy + vix + funding) / 4`（R4d Step 3 の拡張、重み均等）

### パラメータグリッド

R4d Step 3 と同じ param に加え:
- `fundingLookback`: [180, 365, 730] （rolling percentile window）
- 既存 params: `dxySmaPeriod`, `vixThreshold`, `rebalanceThreshold`

3 × 3 × 3 × 2 = 54 combos（R4d Step 3 は 18 combos だった。計算時間注意）

---

## 4. 実装

### ファイル追加

```
yfinance-service/main.py                     # /funding/daily 追加（Binance proxy）
prisma/schema.prisma                         # FundingRate モデル + migration
src/data/funding-loader.ts                   # fetch + daily 集計
scripts/backfill-funding-rate.ts             # 6.5年 backfill
src/backtest/continuous-sizing-v2-engine.ts  # 4-signal 版（Step 3 の拡張）
scripts/walk-forward-continuous-sizing-v2.ts # WF 実行
```

### 「v2」にする理由

R4d Step 3 の engine (`continuous-sizing-engine.ts`) は維持。比較ベースラインとして使う。v2 は 4 signal 版。

### Prisma モデル

```prisma
model FundingRate {
  id      String   @id @default(cuid())
  symbol  String   // "BTCUSDT"
  time    DateTime // funding interval end time
  rate    Float    // raw funding rate per interval (e.g., 0.0001 = 0.01%)

  @@unique([symbol, time])
  @@index([symbol, time])
}
```

日単位は引き算で計算（raw は 8-hourly）。

---

## 5. 評価基準

### 比較セット

| 戦略 | 期間 | Sharpe | DD | Drop | Beats BH? |
|---|---|---|---|---|---|
| BH | 6.5y (2019-10 以降) | ? | ? | — | baseline |
| R4d Step 3 (再計算) | 6.5y | ? | ? | ? | ? |
| **R5 (Step 3 + funding)** | 6.5y | ? | ? | ? | ? |

10 年 BH の Sharpe 1.102 と、6.5 年 BH の Sharpe は別物なので、ベースライン再計算必須。

### 判定

- **SAVED**: R5 Sharpe ≥ 1.0 AND Beats BH AND drop ≤ 30% → 本 repo 初の主KPI 全クリア
- **IMPROVED**: R5 Sharpe > R4d Step 3 AND drop ≤ 30% → 明確な positive、ただし BH 未達
- **NO EFFECT**: 改善 ±0.1 以内 → funding rate に predictive power なし
- **WORSE**: R4d Step 3 より悪化 → Round 4d の方が堅牢だった、Round 5 撤回

---

## 6. リスクと注意

1. **データ期間短縮**: 6.5 年は WF 窓数が減る（18 → 約 11）→ 統計的信頼性低下
2. **Survivor bias**: Binance BTCUSDT perp が存続した期間のデータしかない
3. **Funding rate の Regime 変化**: ETF 以降 (2024-)、funding の水準自体が変わった可能性 → rolling percentile 採用で緩和
4. **4 signal 均等重みの妥当性**: funding rate が最強 signal だとしたら重み 0.25 は過小評価になる。将来的に weighted ensemble 検討
5. **計算時間**: 54 combos × 11 WF windows = 594 バックテスト。R4d Step 3 の 18 × 18 = 324 より約 2 倍

---

## 7. 成果物

- コード 6 files
- テスト 3-5 件追加
- DB: `FundingRate` 約 7,000 行（2019-10 以降、日 3 回 × 6.5 年）
- レポート: `docs/specs/round-5-findings.md`
- 判定: 主 KPI 達成 or 次方向への更新
