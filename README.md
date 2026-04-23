# auto-crypto-trader

BTC/ETH の target position を日次で算出し、virtual portfolio として運用する Scheme E 実装。

- **Strategy:** Scheme E — 2-signal weighted ensemble (DXY 0.60 + Funding 0.40)
- **運用:** Phase 1.5 — exchange 接続なし、virtual P&L で追跡
- **自動化:** macOS launchd 毎日 09:05 JST (= 00:05 UTC)
- **通知:** Slack Incoming Webhook (任意)

---

## 毎日やること

**何もしなくてよい。** launchd が 09:05 JST に `scripts/daily-live-run.sh` を自動実行し、以下をこなす:

1. yfinance sidecar 起動
2. BTC-USD / ETH-USD の signal 計算 & virtual rebalance
3. `VirtualPortfolioState` テーブル + `reports/live/YYYY-MM-DD-<asset>.json` に記録
4. Slack 通知（`SLACK_WEBHOOK_URL` 設定時のみ）
5. sidecar 停止

### 動作確認

```fish
# launchd が登録されているか
launchctl list | grep auto-crypto

# 直近の実行ログ
tail -n 50 /tmp/auto-crypto-trader-live.out.log
tail -n 50 /tmp/auto-crypto-trader-live.err.log

# 最近 30 日の equity / target 履歴
npx tsx scripts/live-dashboard.ts --asset=BTC-USD --days=30
npx tsx scripts/live-dashboard.ts --asset=ETH-USD --days=30
```

### 状況別の対応

| 状況 | 対応 |
|---|---|
| Slack 通知が届いた | なし。ログ見るだけ |
| PC が sleep で実行されなかった | `launchctl kickstart -k gui/(id -u)/com.user.auto-crypto-trader.live` で手動実行 |
| 一時的に止めたい | `launchctl unload ~/Library/LaunchAgents/com.user.auto-crypto-trader.live.plist` |
| 再開 | `launchctl load ~/Library/LaunchAgents/com.user.auto-crypto-trader.live.plist` |
| Slack 通知の見た目を変えたい | `scripts/slack-notify.sh` を編集 |

### 自動 wake（毎日 09:00 JST に Mac を起こす）

launchd は **Mac が sleep 中だと発火しない** ため、毎朝自動で wake させる設定を併用する。

```fish
# 毎日 09:00 JST に wake or power on (MTWRFSU = 月〜日)
sudo pmset repeat wakeorpoweron MTWRFSU 09:00:00

# 現在の設定確認
pmset -g sched

# 解除
sudo pmset repeat cancel
```

`pmset repeat` はスケジュールを 1 つしか保持できないため、`cancel` で解除後に再登録する。

---

## セットアップ

詳細は [`docs/specs/live-operations.md`](docs/specs/live-operations.md)。

- **DB 初期化**: PostgreSQL + `npx prisma migrate deploy`
- **backfill**: `scripts/backfill-*.ts` を順に実行
- **launchd 登録**: `scripts/com.user.auto-crypto-trader.live.plist` を `~/Library/LaunchAgents/` に配置して `launchctl load`
- **Slack 通知（任意）**: `.env.live.example` → `~/.config/auto-crypto-trader/env` にコピーして `SLACK_WEBHOOK_URL` を設定

---

## 主な成果物

- **Strategy 設計**: [docs/specs/round-7-findings.md](docs/specs/round-7-findings.md) (Scheme E 確定), [docs/specs/round-8-findings.md](docs/specs/round-8-findings.md) (robustness)
- **Backtest engine**: [src/backtest/weighted-ensemble-engine.ts](src/backtest/weighted-ensemble-engine.ts)
- **Live 層**: [src/live/signal-computer.ts](src/live/signal-computer.ts), [src/live/portfolio-simulator.ts](src/live/portfolio-simulator.ts)
- **Daily entry**: [scripts/daily-live-run.sh](scripts/daily-live-run.sh), [scripts/live-rebalance.ts](scripts/live-rebalance.ts)
- **運用 doc**: [docs/specs/live-operations.md](docs/specs/live-operations.md)

---

## Phase

| Phase | 内容 | Status |
|---|---|---|
| 1 | Signal 計算 & 記録のみ（手動 rebalance 想定） | ✅ |
| 1.5 | Virtual P&L tracking（実資金なしで追跡） | ✅ 稼働中 |
| 2 | Binance testnet 自動執行 | 未着手 |
| 3 | Mainnet 自動執行 | 未着手 |
