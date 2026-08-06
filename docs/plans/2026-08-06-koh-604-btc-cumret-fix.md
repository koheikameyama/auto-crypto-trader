# BTC cumulativeReturn 破損の調査・修正 — KOH-604

**日付:** 2026-08-06
**発見:** KOH-566（ETH 再評価）の reference 出力
**状態: ✅ 修正・backfill 完了**

---

## 1. 症状

BTC actual の `ActualPortfolioState.cumulativeReturn` が **2026-07-30 に -3.09% → +93.57% へ不連続に跳躍**し、以降 +90〜93% で張り付いていた（08-06 時点 +92.64%）。equity 実額は全期間 ¥47,000〜48,000 で正常。cumRet 表示のみ破損。

---

## 2. 根本原因

**2026-07-29 に ETH の actual row が欠落 → 翌日の portfolio cumret 計算で総資本が半分に誤認識。**

連鎖:
1. 2026-07-29、ETH の maker SELL LIMIT（0.02 ETH）が wait 窓内で未約定。MARKET fallback も約定せず。
2. 旧 `execution-adapter.ts` は `if (!fill) throw new Error(...)` で例外を投げていたため、その日の ETH は `writeState` に到達せず **ETH の state row が書かれなかった**。
3. その結果 2026-07-29 は BTC 単独（assetCount=1）の日になった。
4. `computePortfolioCumret` は前日 total を `prev.equityJpy / (1/prevAssetCount)` で復元していた。07-30 の BTC 計算時、`prevAssetCount`（07-29）= 1 なので `prevTotalEquity` = BTC slice ¥48,012 ÷ 1 = ¥48,012（本来は ¥96k 相当）。
5. 当日 `totalEquityJpy`（口座全体）= BTC + ETH ≈ ¥95,914。
6. `dailyReturn` = (95,914 − 48,012) / 48,012 = **+99.8%** → cumret が +93% に跳躍。ETH 分の資本が「BTC の当日リターン」として二重計上された。
7. 以降 `(1 + prevCumret) * ...` で破損値を引きずり続けた。

ETH 側が -2.60% で正常だったのは、07-29 に ETH row が無く 07-30 の ETH は `prev` 無し扱いで自身の base から再計算されたため。

---

## 3. 修正内容

### 3.1 ロジック修正（再発防止）— `src/live/execution-adapter.ts`

**① maker/MARKET 未約定日も必ず state row を carry で書く**
`if (!fill)` の `throw` を `recordStateUnchanged(...)` に置換。前日ポジションを carry した row（`skipReason: "no_fill: ..."`）を書くことで、asset count が日をまたいで常に対称に保たれる。

**② `computePortfolioCumret` を asset-count 非対称に堅牢化**
前日 total の復元を「1 slice ÷ 想定 weight(1/N)」から「**前日の全 asset row の equityJpy を実際に合算**」へ変更。片方の asset が欠落した日でも過小評価が起きない二重防御。単一資産では従来の full-capital TWR に一致。

### 3.2 データ backfill

- `scripts/backfill-eth-2026-07-29.ts`（新規）: 欠落した ETH 2026-07-29 row を 07-28 から carry で補完。
- `scripts/backfill-cumret.ts`（既存、ANCHOR 2026-07-03）: 全日程の portfolio cumret を再計算。

**適用結果（Railway DB、2026-08-06）:**
- ETH 2026-07-29 row を 1 件挿入
- cumret 68 rows 更新
- 07-30 BTC: +93.57% → **-2.91%**、08-06 BTC: +92.64% → **-3.38%**
- 全日程で BTC cumret = ETH cumret（portfolio-level parity）、+50% 超の破損行 0 件

---

## 4. 検証

- `npx tsc --noEmit`: pass
- `npx vitest run`: 184 tests pass
- `compare-dashboard.ts --asset=BTC --days=40`: actual return -3.38%、max divergence 3.71pp（以前 +92% / 100pp）
- cumret parity: 07-30 以降すべての日で BTC = ETH 一致

---

## 5. 波及確認

| 参照元 | 影響 | 状態 |
|---|---|---|
| `compare-dashboard.ts` BTC cumRet 表示 | 誤表示していた | ✅ backfill で解消 |
| `monthly-summary.ts` BTC リターン集計 | 7〜8月分が誤り | ✅ backfill で解消（cumret 参照は同テーブル） |
| kill-switch（drawdown）| **cumRet ではなく口座全体 equity 参照**（`checkDrawdownKill`、totalEquityJpy ベース）なので今回の cumRet 破損の影響を受けない | ✅ 誤発火リスク無し（設計上分離済） |

kill-switch は Phase 2.2 の教訓（commit `0a5a521`）で既に「per-asset cumret ではなく合計 equity」で判定するよう修正済みのため、今回の破損では誤発火しなかった。

---

## 6. 関連リンク

- Linear: [KOH-604](https://linear.app/koheikameyama/issue/KOH-604)（親: [KOH-566](https://linear.app/koheikameyama/issue/KOH-566)）
- 前段の同種バグ: [docs/plans/2026-05-12-phase-2-2-small.md](2026-05-12-phase-2-2-small.md) 4.3 節、commit `0a5a521` / `be253b4`
- ETH 再評価: [docs/plans/2026-08-06-koh-566-eth-reevaluation.md](2026-08-06-koh-566-eth-reevaluation.md)
