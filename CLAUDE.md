# auto-crypto-trader — Claude Code 向け プロジェクト指示

## プロジェクト概要

BTC/ETH の日次 rebalance を行う暗号通貨自動取引システム。

- **戦略**: Scheme E — 2-signal weighted ensemble (DXY 0.60 + Funding 0.40)
- **検証**: Round 7/8 で 10 年 backtest 検証済（OOS Sharpe 1.10）
- **取引所**: GMO Coin（spot、JPY pair）
- **実行**: GitHub Actions + Railway Postgres + cron-job.org（外部精密 cron）
- **通知**: Slack Incoming Webhook
- **監視**: Healthchecks.io（dead-man switch）

詳細は [README.md](README.md) を参照。

---

## 現在の Phase

- ✅ Phase 1.5: Virtual P&L tracking
- 🟢 **Phase 2.1 Micro: ¥30,000 actual execution（2026-04-26 開始、2026-05-09 判定）**
- ⏳ Phase 2.2 Small: ¥100,000（条件 PASS 後）
- ⏳ Phase 2.3 Seed: ¥1,000,000
- ⏳ Phase 3 Target: 本資金

---

## アーキテクチャ

```
cron-job.org (09:05 JST)
  └─ workflow_dispatch → GitHub Actions
       └─ daily-live-run.yml
            ├─ Prisma migrate deploy
            ├─ yfinance-service (Python sidecar) 起動
            ├─ live-rebalance.ts (BTC + ETH virtual)
            ├─ live-execute.ts (BTC actual, EXECUTION_ENABLED=true 時のみ)
            ├─ Slack 通知
            └─ Healthchecks.io ping

cron-job.org (09:35 JST)
  └─ daily-data-collection.yml
       └─ VIX / TNX / GC / CL / on-chain / BTC.D / FGI 更新
```

### 主要コンポーネント

| ファイル | 役割 |
|---|---|
| [src/live/signal-computer.ts](src/live/signal-computer.ts) | Scheme E target_position 計算 |
| [src/live/portfolio-simulator.ts](src/live/portfolio-simulator.ts) | Virtual portfolio 日次 rebalance |
| [src/live/execution-adapter.ts](src/live/execution-adapter.ts) | GMO 実発注（maker LIMIT → MARKET fallback） |
| [src/live/gmo-client.ts](src/live/gmo-client.ts) | GMO Coin REST + HMAC-SHA256 |
| [src/live/kill-switch.ts](src/live/kill-switch.ts) | 連続失敗 / DD / API エラー監視 |
| [src/data/price-loader.ts](src/data/price-loader.ts) | Binance public klines（BTC/ETH 日足） |
| [src/data/macro-loader.ts](src/data/macro-loader.ts) | yfinance 経由 DXY/VIX/TNX 等 |
| [src/data/funding-loader.ts](src/data/funding-loader.ts) | Binance funding rate |
| [src/data/onchain-loader.ts](src/data/onchain-loader.ts) | CoinMetrics on-chain |

### Prisma モデル

- `Asset`: BTC-USD / ETH-USD のメタ
- `DailyBar`: 日足 OHLCV
- `MacroBar`: scalar 時系列（DXY, VIX, TNX, BTC.D, FGI 等）
- `FundingRate`: Binance perp funding 日次平均
- `OnchainMetric`: CoinMetrics データ
- `VirtualPortfolioState`: 仮想 P&L（USD 建て）
- `ActualPortfolioState`: 実 P&L（JPY 建て、GMO）
- `OrderLog`: 発注・約定履歴
- `BacktestRun` / `WalkForwardRun` / `Trade`: backtest 結果

---

## ❗ 重要な作業ルール

### 戦略パラメータの変更について

**Scheme E のパラメータ（wDxy=0.60, wFunding=0.40, threshold 10%, lookback 365 等）は安易に変更しないこと。**

- Round 7/8 で walk-forward 最適化済
- 変更すると Phase 2 の virtual/actual 比較が崩れる
- 変更したい場合は新 Round として backtest 再実行 + plan ドキュメント作成が必須

### 実発注関連の変更

`src/live/execution-adapter.ts` の発注ロジックを変更する場合:

1. 必ず Phase 2.0 Dry を**最小ロットで再実行**して動作確認
2. `--dry-run` モードでまず計算検証
3. OrderLog の整合性を破壊する変更は禁止（idempotent UPSERT を保つ）
4. Kill switch logic の弱体化は禁止

### Migration

- **`prisma migrate dev --name <変更内容>`** を必ず使う
- `prisma db push` は禁止（履歴が残らない）
- `prisma migrate resolve --applied` は **絶対に使わない**（過去 2 度事故）
- Migration ファイルは必ず commit

### Secret 管理

- `.env` は `.gitignore` 済（ローカル開発用）
- 本番は GitHub Secrets:
  - `DATABASE_URL` (Railway Postgres、`?schema=auto_crypto_trader`)
  - `SLACK_WEBHOOK_URL`
  - `GMO_API_KEY` / `GMO_API_SECRET`（取引権限のみ、出金 OFF）
  - `EXECUTION_ENABLED` (true/false)
  - `EXECUTION_ASSETS` (BTC or BTC,ETH)
  - `HEALTHCHECKS_URL`
- `gh secret set` 使用時の注意: `--body -` フラグは使わない（バグで literal `-` が保存される）。stdin から `gh secret set NAME < file` を使う

---

## DB 構成（Railway Postgres）

```
Railway Project: kameyama-system
  └── Postgres service: auto-stock-trader DB（既存、共有）
        └── Database: railway
              ├── Schema: public                ← auto-stock-trader（別 project）
              └── Schema: auto_crypto_trader    ← 本 project
```

- 同 Postgres インスタンスを **schema 単位で分離**（追加コスト ~$0.05/月）
- DATABASE_URL に `?schema=auto_crypto_trader` を必ず付与
- ローカル開発時は `localhost:5432/auto_crypto_trader?schema=public`

---

## 取引所制約

### GMO Coin spot

| 項目 | 値 |
|---|---|
| 最小ロット (BTC) | 0.0001 BTC |
| 最小ロット (ETH) | 0.01 ETH |
| Maker fee | -0.05%（リベート）|
| Taker fee | 0.05% |
| API rate limit | private 6 req/秒 |
| 出金権限 | API key で OFF（重要）|

### データソース

| データ | ソース | 注意 |
|---|---|---|
| BTC/ETH 日足 | Binance kline | GitHub Actions IP で 451 ありうる → DB cache fallback 実装済 |
| DXY 日足 | yfinance (sidecar) | 同上 |
| Funding rate | Binance | 同上 |
| On-chain | CoinMetrics community API | free tier、daily delay |

---

## よく使うコマンド

```fish
# Local 開発
npx prisma migrate dev --name <change>
npx prisma studio   # local DB 閲覧
npx tsx scripts/smoke-test-gmo.ts  # GMO API 疎通確認

# Workflow trigger
gh workflow run daily-live-run.yml --repo koheikameyama/auto-crypto-trader

# 状態確認
gh run list --repo koheikameyama/auto-crypto-trader --limit 5
psql 'postgresql://postgres:...@shinkansen.proxy.rlwy.net:45444/railway' -c '
  SELECT * FROM auto_crypto_trader."ActualPortfolioState" ORDER BY date DESC LIMIT 5;
'

# Compare dashboard（virtual vs actual）
DATABASE_URL='postgresql://...?schema=auto_crypto_trader' \
  npx tsx scripts/compare-dashboard.ts --asset=BTC --days=14

# Kill switch トリガー（緊急停止）
echo -n 'false' | gh secret set EXECUTION_ENABLED --repo koheikameyama/auto-crypto-trader
```

---

## ❌ やってはいけないこと

1. **Scheme E のパラメータを backtest 検証なしに変更**
2. **`prisma migrate resolve --applied`**（事故 2 回）
3. **`prisma db push`**（履歴が消える）
4. **`gh secret set --body -`**（literal `-` 保存バグ）
5. **GMO API key の出金権限を ON**
6. **Multi-asset 配分ロジック未実装のまま BTC + ETH 同時に EXECUTION_ASSETS 設定**（[docs/specs/coin-coverage.md](docs/specs/coin-coverage.md) 参照）
7. **Round 11 計画外の "ついで" 改善**（戦略 stability を保つため）

---

## 関連ドキュメント

- [README.md](README.md) — 運用 quick start
- [docs/specs/round-7-findings.md](docs/specs/round-7-findings.md) — Scheme E 確定
- [docs/specs/round-8-findings.md](docs/specs/round-8-findings.md) — Robustness 検証
- [docs/specs/live-operations.md](docs/specs/live-operations.md) — Phase 1 / 1.5 運用
- [docs/specs/github-actions-deployment.md](docs/specs/github-actions-deployment.md) — Railway + GHA デプロイ
- [docs/specs/coin-coverage.md](docs/specs/coin-coverage.md) — 対応 coin 方針
- [docs/specs/market-evaluation-decision.md](docs/specs/market-evaluation-decision.md) — 市場評価 layer 不要の決定
- [docs/plans/2026-04-24-round-11-phase2-execution.md](docs/plans/2026-04-24-round-11-phase2-execution.md) — Phase 2 実装計画

---

## Linear タスク管理

- Project: **Auto Crypto Trader**
- 親タスク: [KOH-431](https://linear.app/koheikameyama/issue/KOH-431) Round 11 Phase 2
- アクティブ: [KOH-442](https://linear.app/koheikameyama/issue/KOH-442) Phase 2.1 Micro（due 2026-05-09）
- 次: [KOH-444](https://linear.app/koheikameyama/issue/KOH-444) Round 12 Fee 再最適化（due 2026-05-16）

PR 作成時は本文に `Fixes KOH-XX` を記載してマージで自動 close。

---

## グローバル設定（参考）

ユーザー global rules（`~/.claude/CLAUDE.md`）:

- 明示指示外の作業はしない（「ついで」「せっかく」NG）
- 破壊的操作は必ず確認
- fish shell 使用
- N+1 問題に注意（バッチ INSERT）
- JST 時刻基準
- PR 本文・commit に Claude Code 情報を含めない
