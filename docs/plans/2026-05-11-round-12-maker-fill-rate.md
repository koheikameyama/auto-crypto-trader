# Round 12 — Maker LIMIT Fill 率改善

**作成日:** 2026-05-11
**前提:** Round 7/8 で確立した Scheme E に戦略変更を加えない範囲で、execution layer の経済性を改善する
**当初スコープ:** Fee 再最適化 → 実測値（taker +7.9 bps）が backtest 前提（+10 bps）より良かったため、スコープを「maker fill 率改善」へピボット（[KOH-444 訂正コメント](https://linear.app/koheikameyama/issue/KOH-444)）

---

## 1. 問題と目標

### 観測された問題

2026-05-10 の round-trip テスト（`scripts/test-execution-roundtrip.ts`）で:

- Maker LIMIT（inside best bid/ask、10s 待機）の fill 率: **0% (0/2)**
- 全 trade が MARKET fallback で taker fee +7.9 bps を負担
- 翌日 5/11 の自動 rebalance（SELL 0.0005 BTC）も同様に taker と推定（fee/trade ≈ 7.9 bps）

### 目標

| 指標 | 現状 | 目標 |
|---|---|---|
| Maker LIMIT fill 率 | 0% | **30〜50%** |
| Effective fee（fill 率込み） | +7.9 bps | **0 〜 -2.5 bps**（maker rebate -5bps × fill 率） |

### Sharpe への寄与（試算）

- 年間 rebalance 回数: ~9〜15 回（target distribution 分析より）
- 1 trade あたり fee 差: 12.5 bps（taker +7.5 → maker -5）
- 年間 fee 削減: 12.5 × 15 = **187 bps/年（最大ケース）**
- Sharpe 寄与: +0.05〜+0.10 程度

戦略パラメータは触らないので Round 7/8 の baseline は維持される。

---

## 2. 仮説

| # | 仮説 | 検証方法 |
|---|---|---|
| H1 | 10s 待機は短すぎる。60s に延長で fill 率改善 | wait=10s vs 60s で round-trip 各 N 回 |
| H2 | 300s 待機でさらに改善するが diminishing return | wait=60s vs 300s |
| H3 | 指値を inside（best bid/ask）より +1 tick 内側に置くと fill 率↑、ただし slippage 悪化 | offset=0 vs +1 |
| H4 | 時間帯で流動性が異なり fill 率も変動 | 朝/昼/夜で同条件繰返し |

---

## 3. 実験設計

### 試行マトリクス（最小限）

| Run | wait_sec | offset_ticks | サンプル数 | 想定コスト |
|---|---|---|---|---|
| baseline | 10 | 0 (inside) | 5 round-trip | ¥15 |
| W60-I0 | 60 | 0 | 5 round-trip | ¥15〜30 |
| W300-I0 | 300 | 0 | 5 round-trip | ¥15〜30 |
| W60-I1 | 60 | +1 tick | 5 round-trip | ¥15〜30 |

各 round-trip = BUY + SELL（net position-neutral）= 2 LIMIT 試行。合計 40 LIMIT 試行。

### 計測項目（1 試行あたり）

- LIMIT が fill したか（boolean）
- LIMIT fill 時の待機時間（秒）
- LIMIT fill 時の execPrice vs refMid（bps）
- MARKET fallback 時の slippage（bps）
- Fee（¥）

### 出力

- 試行結果を CSV に記録（`reports/round-12/maker-fill-{timestamp}.csv`）
- 集計レポート: fill 率、平均 fee、effective fee/trade を構成別に表示

---

## 4. 実装

### 新規

- `scripts/test-maker-fill-rate.ts` — 上記 matrix を実行
  - CLI: `--wait-sec=N --offset-ticks=N --count=M`
  - OrderLog 書込み（`errorMessage` に `round_12_fill_rate` tag）
  - ActualPortfolioState には書込まない（Phase 2.1/2.2 ledger は無汚染）
  - 既存 `test-execution-roundtrip.ts` の order placement ロジックを共通化

### 既存利用

- `src/live/gmo-client.ts` — そのまま
- OrderLog の `errorMessage` フィールド — 試行ごとの tag 用

---

## 5. 安全策

- **試行ごとに最小ロット**（BTC 0.0001）で実行、絶対サイズ ¥1,500
- BUY → SELL を 1 round-trip として **必ず net position-neutral**
- GMO maintenance 時は自動 retry せず即 fail（手動再開）
- 試行間隔 10s 以上（rate limit 余裕）
- 1 batch は **5 round-trip 上限**（合計 ¥30 程度に抑える）

---

## 6. 完了条件

- [ ] 40 LIMIT 試行のデータ収集完了
- [ ] Fill 率の構成別集計レポート
- [ ] 推奨設定の決定（wait_sec, offset_ticks）
- [ ] `execution-adapter.ts` の `makerLimitWaitSec` デフォルト値更新（必要なら）
- [ ] Backtest cost-model に「期待 effective fee」を反映するか判断
- [ ] Round 12 findings doc 作成

---

## 7. スコープ外

- 戦略パラメータ変更（wDxy, wFunding, threshold, lookback）→ Round 11/Phase 2 baseline 維持
- 新 signal 追加
- postOnly フラグ採用判断（fill 率が極端に低ければ採用検討、まずは現状ロジックで測る）
- Multi-asset 対応（ETH への展開は別 Round）

---

## 8. タイムボックス

| Phase | 内容 | 見積 |
|---|---|---|
| A | スクリプト実装 + 型 check | 1 時間 |
| B | Matrix 実行（時間帯分散） | 1〜2 日（実時間） |
| C | 集計 + findings doc | 1 時間 |
| **合計** | | **~4 時間 + 1〜2 日** |

Due: 2026-05-16（KOH-444）

---

## 9. リスク

| リスク | 影響 | Mitigation |
|---|---|---|
| 300s 待機中に market が急変、約定後の slippage が想定外 | 1 trade あたり大きな slip | LIMIT 価格は inside だから不利方向には動かない（fill しない方に動くだけ） |
| GMO API rate limit | 試行中断 | 試行間 10s sleep、batch 最大 5 |
| postOnly 未指定で意図せず taker 約定 | 名目 maker のはずがフィー taker | 現コードは postOnly 指定なし。今 Round で要検証 |
