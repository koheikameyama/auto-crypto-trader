# Round 14 — SOL/BNB Cross-Asset Validation（Scheme E の横展開）

**作成日:** 2026-07-04
**前提:** Round 7/8 で確立した Scheme E (DXY 0.60 + Funding 0.40) の固定 weight を**一切変更せず**、そのまま SOL/BNB に適用して汎化性を検証する
**動機:** Round 8 で「BTC→ETH で同じ weight が機能 = 真のマクロ edge」と確認済。findings の Round 8 候補 C「Other alts (SOL, BNB) cross-asset validation」を実施し、Scheme E の edge が BTC/ETH 固有でないことを示す

---

## 1. 目標

| 指標 | ETH baseline (Round 8) | Round 14 目標（SOL/BNB 各々） |
|---|---|---|
| OOS Sharpe | 1.026 | **Beats それぞれの BH** |
| IS→OOS Drop | -1.9% | **≤ 30%** |
| Beats BH | YES | **YES（weak pass 条件）** |

- Scheme E は **固定 weight**（in-sample 最適化なし）なので、SOL/BNB で Beats BH かつ drop ≤ 30% なら「真のマクロ edge」がさらに補強される
- SOL/BNB のどちらか一方でも成立すれば cross-asset robustness の証拠として価値あり（Round 8 ETH と同じ判定基準）

---

## 2. 検証設計（Round 8 ETH の完全な横展開）

- weight: `wDxy=0.60, wFunding=0.40`（他は 0）— **固定、触らない**
- hyper-grid: ETH と同一（dxySmaPeriod ∈ {100,200}, rebalanceThreshold ∈ {0.1,0.05}）。in-sample で hyper のみ選択、weight は固定
- WF 窓: IS 365 / OOS 182 / step 182（暦日ベース、既存踏襲）
- 判定: strict = Sharpe ≥ 1.0 & DD ≤ 50% & drop ≤ 30% & Beats BH / weak = Sharpe ≥ 0.9 & Beats BH & drop ≤ 30%

---

## 3. データ

| データ | ソース | 期間 | 注意 |
|---|---|---|---|
| SOL-USD / BNB-USD 日足 | Binance kline（SOLUSDT/BNBUSDT）→ CoinGecko fallback | SOL ~2020-08、BNB ~2017-11 | price-loader に symbol mapping 追加 |
| SOLUSDT / BNBUSDT funding | sidecar `/funding/daily`（Binance fapi） | **SOL perp ~2020-09、BNB perp ~2020-02** | funding 開始が backtest 期間の下限を決める |
| DXY | 既存 MacroBar（共有） | 10y | 変更不要 |

- **有効 backtest 期間は funding 開始で律速**: SOL ~5.8y、BNB ~6.4y（ETH の 6.5y と同等スケール）
- onchain は wOnchain=0 で未使用（ETH 検証と同じく placeholder として BTC onchain を渡すか空配列）

---

## 4. 実装

### 型・config・loader（Phase A）

- `src/types/asset.ts` — `AssetSymbol` union と `ASSETS` に `SOL-USD` / `BNB-USD` 追加
  - **live 実行系は `ASSETS` を import していない**（`src/live/` で確認済）。live は `--asset` CLI + `EXECUTION_ASSETS` env 駆動なので baseline 非汚染
- `src/data/asset-config.ts` — SOL-USD/BNB-USD の config（yfinanceTicker, feeRate）追加
- `src/data/price-loader.ts` — Binance/CoinGecko の symbol mapping 追加（SOLUSDT/solana, BNBUSDT/binancecoin）

### backfill（Phase B）

- 価格: `backfill-crypto-prices.ts` は `ASSETS` を loop するので SOL/BNB を追加すれば自動対応
- funding: `backfill-eth-funding.ts` を汎用化した `backfill-alt-funding.ts --symbol=SOLUSDT --start=2020-09-01` を新設（または既存 backfill-funding-rate.ts を流用）

### WF（Phase C）

- `walk-forward-scheme-e-eth.ts` を asset 引数対応に汎用化 → `walk-forward-scheme-e.ts --asset=SOL-USD --funding=SOLUSDT --start=2020-09-01`
- ETH 版は既存のまま温存（回帰確認用）

---

## 5. 安全策

- **Scheme E core weight を変更しない**（forbidden #1）
- **live 実行系（signal-computer.ts, execution-adapter.ts, portfolio-simulator）に一切触らない** — backtest only
- **Phase 2.2 Small ledger を汚染しない**（virtual/actual 別テーブル、backtest は WalkForwardRun のみ書き込み）
- `ASSETS` への SOL/BNB 追加は backtest/backfill scripts のみに波及（live 非 import を確認済）。ただし `EXECUTION_ASSETS` に SOL/BNB を**絶対に入れない**（GMO 発注ロジック未対応）

---

## 6. 完了条件

- [ ] SOL/BNB 価格 backfill（欠損 < 5%）
- [ ] SOLUSDT/BNBUSDT funding backfill
- [ ] SOL/BNB 各々の WF 結果（OOS Sharpe / DD / drop / Beats BH）
- [ ] Round 14 findings doc 作成
- [ ] 採否判断: Beats BH かつ drop ≤ 30% なら cross-asset robustness 確認。live 統合は本 Round scope 外（GMO 取扱・multi-asset 配分は別 Round）

---

## 7. スコープ外

- Scheme E core weight 変更
- Live execution への SOL/BNB 統合（GMO 取扱可否・multi-asset 配分は KOH-480 の範囲）
- 新 signal 探索、SOL/BNB 固有 signal 開発
- Round 13 BTC.D overlay（別 Round、独立）

---

## 8. リスク

| リスク | 影響 | Mitigation |
|---|---|---|
| SOL/BNB funding の Binance perp 開始が遅く期間短い | 統計的信頼性低下 | 最低 5y 確保（SOL ~5.8y, BNB ~6.4y）。ETH 6.5y と同等なので許容 |
| SOL/BNB は BTC/ETH よりマクロ感応度が低い可能性 | Beats BH 未達 | 未達でも「edge は BTC/ETH 級 large-cap 限定」という有益な negative result |
| `ASSETS` 追加が live に波及 | baseline 崩壊 | live 非 import 確認済。EXECUTION_ASSETS には入れない |
| Binance kline が GitHub Actions IP で 451 | backfill 失敗 | ローカル実行 + CoinGecko fallback |
