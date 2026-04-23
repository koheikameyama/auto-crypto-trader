# Round 4b: BTC-ETH Pair Trading

**作成日:** 2026-04-23
**前提:**
- Round 3 FAIL (4戦略 × 2銘柄 = 8/8 FAIL)
- Round 4a FAIL (SMA50 トレンドフィルタでは救済できず)
- **単一銘柄トレンド/ミーンリバージョン戦略は crypto で機能しない**ことが確定

**目的:** **戦略クラスを根本から変える**。BTC と ETH の価格比率（spread）の mean-reversion を狙うペアトレード戦略を実装し、WF で検証。
**期待工数:** 4-6 時間

---

## 1. 仮説

**H2「BTC-ETH は高相関 (~0.85) ペア。log(BTC/ETH) の z-score は短中期で平均回帰する」:**
- BTC・ETH は同じマクロ要因（crypto 全体の risk-on/off）に連動しつつ、個別要因（ETF、L2 activity、alt season）で短期スプレッドが開閉
- log-ratio に z-score を当て、z > +2 で「BTC 過熱 vs ETH」→ short spread（BTC short / ETH long）
- z < -2 で「BTC 過冷」→ long spread（BTC long / ETH short）
- |z| < 0.5 で平均回帰 → 両レッグ同時クローズ

**H2 が正なら:**
- 単一銘柄の trend 戦略と**独立した**エッジが存在する
- OOS Sharpe ≥ 1.0 達成の可能性
- Market-neutral に近いので DD も抑制される

**H2 が誤なら:**
- crypto の spread は平均回帰しないか、手数料に負ける
- Round 4c（オンチェーン指標）へ移行

---

## 2. 戦略仕様

### シグナル生成（1 bar / 日次）

1. 各 bar で `spread_t = log(close_btc) - log(close_eth)` を計算
2. 過去 `lookback` 日の rolling mean `μ` と std `σ` を計算
3. `z_t = (spread_t - μ) / σ`
4. エントリー判定:
   - `z > +entryThreshold` かつポジションなし → **SHORT spread**（BTC short / ETH long）
   - `z < -entryThreshold` かつポジションなし → **LONG spread**（BTC long / ETH short）
5. エグジット判定:
   - `|z| < exitThreshold` → 両レッグ同時クローズ（平均回帰成功）
   - `|z| > stopThreshold` → 両レッグ同時クローズ（runaway、損切り）
   - 保有日数 ≥ `timeStopDays` → 両レッグ同時クローズ（時間切れ）

### デフォルトパラメータ

| 項目 | 値 |
|---|---|
| lookback | 30 日 |
| entryThreshold | 2.0 σ |
| exitThreshold | 0.5 σ |
| stopThreshold | 3.5 σ |
| timeStopDays | 30 日 |

### パラメータグリッド（WF 最適化用）

| Param | Values |
|---|---|
| lookback | 20, 30, 60 |
| entryThreshold | 1.5, 2.0, 2.5 |
| exitThreshold | 0.0, 0.5, 1.0 |

合計 3×3×3 = 27 combos（RSI の 48 より軽い）。`stopThreshold` / `timeStopDays` は固定（過学習回避）。

---

## 3. 実装方針

### ポジションサイジング（MVP 原則）

- ポジション建て時に `capital/2` を各レッグに均等割り当て（dollar-neutral）
- `btcUnits = (capital * 0.5) / btcEntryPrice`
- `ethUnits = (capital * 0.5) / ethEntryPrice`
- Risk ratio 1% ではなく **capital 配分ベース**。理由:
  - Pair trade は market-neutral で単独レッグの SL が定義しにくい
  - Z-score が stop threshold (3.5σ) に達したら撤退するため、実質的な max loss はそこで決まる
  - シンプル優先の MVP 選択

### PnL 計算

```
long_spread_pnl = btc_pnl (long) + eth_pnl (short)
                = (btc_exit - btc_entry) * btc_units
                - (eth_exit - eth_entry) * eth_units
                - fees (entry + exit on both legs, 0.1% × 4 = 0.4% round trip)
```

- 手数料: 両レッグの `applyFee` を使用（既存 cost-model.ts 流用）
- Funding rate: MVP では 0、将来感度分析

### ファイル構成

```
src/
├── lib/
│   └── spread.ts              # NEW: computeLogSpread, rollingMeanStd, zScore
├── core/
│   └── pair-trade/
│       └── index.ts            # NEW: PairTradeParams + signal generator (non-Strategy type)
├── backtest/
│   ├── pair-engine.ts         # NEW: 2-leg simultaneous backtest
│   └── pair-trade-run.ts      # NEW: CLI for single run
└── walk-forward/
    └── pair-engine.ts         # NEW: WF wrapper for pair trade
scripts/
└── walk-forward-pair-trade.ts # NEW
```

### 既存 engine との関係

- 単一銘柄用 `backtest/engine.ts` とは**別の engine** として実装
- `EntrySignal` / `Strategy<P>` 型は使わず、独自の `PairSignal` / `PairStrategyConfig` を使う
- KPI 計算 (metrics.ts) / WF optimizer は流用可能（equity curve → returns → Sharpe）

---

## 4. 評価基準

Round 3 / 4a と**同じ主KPI**:

| KPI | 閾値 |
|---|---|
| OOS Sharpe | ≥ 1.0 |
| OOS MAR | ≥ 0.5 |
| OOS PF | ≥ 1.3 |
| OOS Max DD | ≤ 30% |
| IS→OOS Sharpe drop | ≤ 30% |

**追加比較:**
- 戦略 Sharpe > **max(BTC BH Sharpe, ETH BH Sharpe)** = 1.102（BTC BH）を要求
  - pair trade は market-neutral を謳う → 個別 BH を超えないと「ただの危険な hedge」
- 最小取引数: 20（WF 10年で 20 以上ないと統計的に無意味）

### 判定
- **SAVED**: 上記主KPI 全達成 & Sharpe > 1.102 → Round 4b 成功、H2 採用
- **IMPROVED**: OOS Sharpe ≥ 0.5 かつ drop ≤ 50% → 片鱗あり、パラメータ調整の余地
- **FAIL**: 上記未達 → H2 却下、Round 4c（オンチェーン）へ

---

## 5. リスクと注意

1. **β = 1 固定（log(BTC)−log(ETH)）の単純化**: 真の cointegration vector (OLS β) を使う手法もあるが MVP では単純化。結果次第で β 推定を Round 4b-2 で試す
2. **ロング・ショート同時執行**: 現実の執行はスプレッド（bid-ask）分不利。本実装では片方向 0.1% × 2 レッグで擬似的にカバー
3. **Lookback による look-ahead**: z-score は過去 N 日のみから計算する実装に注意。`includes current bar` 同士での学習はセーフ、未来バーに触れてはいけない
4. **BTC/ETH 両方の bars が揃う期間のみ**: ETH は 2017年11月開始。それ以前の BTC bar は使えない
5. **サンプルサイズ**: entry threshold 2σ は statistical に 5% の確率でしか発生しない → 10年で機会は 100-200 回想定。lookback 30 × threshold 2.0 で実機会数を WF 前に簡易確認

---

## 6. 成果物

- コード:
  - `src/lib/spread.ts` + tests
  - `src/core/pair-trade/index.ts`
  - `src/backtest/pair-engine.ts` + tests
  - `src/backtest/pair-trade-run.ts`（CLI）
  - `src/walk-forward/pair-engine.ts`
  - `scripts/walk-forward-pair-trade.ts`
- 実行:
  - 単独 backtest 1 run (デフォルトパラメータ、フル期間)
  - WF 1 run (27 combos × 約 14 windows、ETH 制約により)
- レポート: `docs/specs/round-4b-findings.md`
  - R3/R4a との比較
  - H2 採用 or 却下判定
  - Round 4c への指針

---

## 7. タイムボックス

| フェーズ | 目安 |
|---|---|
| spread.ts + tests | 30分 |
| pair-engine.ts + tests | 90-120分 |
| pair-trade-run.ts + WF wrapper + script | 60分 |
| 実行 (backtest + WF) | 30分（spread は軽い） |
| findings レポート | 30-45分 |
| **合計** | **約 4-5 時間** |
