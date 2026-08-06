# Phase 2 ETH パフォーマンス再評価（1ヶ月後）— KOH-566

**評価日:** 2026-08-06
**対象期間:** ETH actual execution 2026-07-04 〜 2026-08-06（33 日、common 33 rows）
**判定: ✅ PASS → ETH multi-asset 継続**

---

## 1. 背景

ETH の actual execution は 2026-07-04 開始。KOH-566 は「統計的に有意な評価には 1 ヶ月のデータが必要」として作られたタスク。作成時（2026-07-18）は 14 日分・divergence +5.96pp（初期 gap 込み）で評価保留になっていた。今回は約 4.7 週分（33 日）のデータで再評価した。

---

## 2. 評価方法（重要: 初期ベースライン差の扱い）

`compare-dashboard.ts` が出す **生の A-V 乖離（末尾 +4.85pp）は tracking 誤差ではない。**

- Virtual ETH portfolio は **2026-04-23 稼働開始**（106 日、$10,000 起点）。actual 開始日 2026-07-04 の時点で virtual は既に **cumRet -10.90%** まで沈んでいた。
- Actual ETH の `cumulativeReturn` は自身の開始日（07-04）を起点に計測されるため、初日は -5.32%。
- つまり両系列の起点が違う。初日の diff +5.58pp は **execution 開始前に virtual 単独で蓄積した DD** であり、live execution の追随品質とは無関係。

**フェアな指標** = 両系列を 07-04 で 0 に rebase し、execution 期間内の追随だけを見る。これは BTC の Phase 2.2 PASS判定（末尾 0.73pp）と同じ方式。

| 乖離指標 | 値 |
|---|---|
| 生（as-stored）末尾 A-V | +4.85pp |
| 生 最大 abs | 6.30pp |
| **rebase 後 末尾** | **-0.73pp** |
| **rebase 後 最大 abs** | **1.19pp** |
| **rebase 後 平均** | **+0.03pp** |

rebase 後の平均 +0.03pp・最大 1.19pp は、両系列がほぼ完全に同じ形で動いていることを示す。

---

## 3. 判定結果

**総合: PASS。** ticket の基準「divergence < 3pp → ETH 継続」を、フェアな window 乖離（最大 1.19pp）で明確に満たす。

| 指標 | 目標 | 実測 | 判定 |
|---|---|---|---|
| Virtual vs Actual 乖離（window, rebase 後） | < 3pp | 末尾 -0.73pp / 最大 1.19pp / 平均 +0.03pp | ✅ |
| Slippage（平均） | ≤ 1bps | avg 0.44bps / max 4.2bps | ✅ |
| Maker LIMIT fill 率 | ≥ 30% | 81.8%（9/11） | ✅ |
| Effective fee（fill 率込み） | ≤ +5bps | +0.215bps（¥2 / ¥93,080 notional） | ✅ |
| 発注成功率 | ≥ 95% | 100%（22/22、errorMessage 0 件） | ✅ |
| Kill switch trigger | 0 回 | 0 回 | ✅ |
| Rebalance 整合性（V/A） | — | virtual 16 / actual 10（後述） | ✅（説明可能）|

---

## 4. 補足

### 4.1 Rebalance count の差（virtual 16 vs actual 10）
Virtual は日次で target を追うが、actual は 10% しきい値・最小ロット（ETH 0.01）・maker wait の制約で発注をまとめる/見送るため件数が減る。設計どおりで、これによる乖離は rebase 後 1.19pp 内に収まっている。

### 4.2 2026-07-29 の maker 未約定（benign no-fill）
07-29 SELL LIMIT 0.02 ETH @ ¥313,000 が wait 窓内で約定せず、MARKET fallback も無しで翌日 target が反転（07-30 は BUY）。compare 上は 07-29 が `Reb ★/·`（virtual のみ）。BTC PASS判定でも指摘された「単日 rebalance せず equity 横ばい → 翌日以降で解消」のタイミングラグと同型で、系統誤差ではない。

### 4.3 執行の質
- Maker fill 9/11、MARKET fallback は 07-10 の 1 回のみ（fee ¥5）。
- 直近は maker リベートが効き feeJpy が -¥1 の trade も複数（07-27, 07-28, 08-06）。
- 部分約定は 07-04（0.019/0.020）と 08-06（0.034/0.050）の 2 件だが、いずれも target 追随に実害なし。

---

## 5. ⚠️ 別件で発見: BTC の cumulativeReturn 破損（KOH-566 対象外）

再評価の reference として BTC 40 日を出したところ、**BTC actual の `cumulativeReturn` が 2026-07-30 に -3.09% → +93.57% へ跳ねる異常**を発見。equity は ¥47〜48k で横ばいのまま cumRet だけが +93% に張り付いている（08-06 時点 +92.64%）。equity 実額は正常なので運用損益への影響は無いが、compare-dashboard / 月次サマリの BTC cumRet 表示と、cumRet を参照する kill-switch 等に影響しうる。

- 症状: 07-29（-3.09%）→ 07-30（+93.57%）で不連続、以降張り付き
- equity: 全期間 ¥47,000〜48,000 で正常
- 本 KOH-566（ETH）の判定には無関係だが、**別タスクでの調査・backfill を推奨**（Phase 2.2 の cumret 総 equity 化 backfill と同種の会計バグの可能性）

---

## 6. 結論とアクション

- ✅ **ETH multi-asset 継続。** live execution の追随・執行・fee すべて健全。
- 📌 BTC cumulativeReturn 破損は別タスク [KOH-604](https://linear.app/koheikameyama/issue/KOH-604) として起票済（compare/月次サマリ/kill-switch への波及確認 + backfill）。

---

## 7. 再現コマンド

```fish
# 本評価の生データ
npx tsx scripts/compare-dashboard.ts --asset=ETH --days=40
npx tsx scripts/compare-dashboard.ts --asset=BTC --days=40   # BTC cumret 異常が見える
```

---

## 8. 関連リンク

- Linear 本タスク: [KOH-566](https://linear.app/koheikameyama/issue/KOH-566) Phase 2 ETH 再評価
- 前段 PASS判定: [docs/plans/2026-05-12-phase-2-2-small.md](2026-05-12-phase-2-2-small.md)（BTC 単独、rebase 方式 0.73pp）
- 増額判断: [docs/plans/2026-07-28-phase2-scale-up-criteria.md](2026-07-28-phase2-scale-up-criteria.md)
