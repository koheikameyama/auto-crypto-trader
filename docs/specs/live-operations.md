# Live Operations Handbook (Phase 1)

**対象:** Round 9 Phase 1 — 観測・記録のみ、exchange 執行なし
**前提:** Scheme E (DXY 0.60 + Funding 0.40) を日次で観測し、リバランス必要時に**手動**で執行する運用

---

## 1. 前提セットアップ

### 1.1 必要なもの

- PostgreSQL running (DATABASE_URL 設定済)
- yfinance-service running on port 8766
- Prisma migrations 適用済 (`npx prisma migrate deploy`)
- 過去データ backfill 済 (DXY, BTCUSDT funding)

### 1.2 初回 backfill 確認

```fish
# DB に MacroBar (DXY), FundingRate (BTCUSDT) が入っているか
npx prisma studio   # → 目視確認
```

最低限必要な履歴: 過去 1 年以上（percentile 計算の warm-up 用）。既に backfill 済みなら OK。

---

## 2. 日次実行

### 2.1 手動実行

```fish
# BTC Scheme E signal 計算 & 記録
npx tsx scripts/live-signal.ts --asset=BTC-USD

# ETH 同時観測する場合
npx tsx scripts/live-signal.ts --asset=ETH-USD
```

### 2.2 出力

2 ヶ所に記録される:

1. **DB**: `LivePositionLog` テーブル (`asset`, `date` で UPSERT)
2. **ファイル**: `reports/live/YYYY-MM-DD-<asset>.json`

### 2.3 rebalance 判定

Default threshold: position 変化 > 0.10 (= 10pp) のとき rebalance flag が立つ。変更するには:

```fish
npx tsx scripts/live-signal.ts --asset=BTC-USD --rebalance-threshold=0.05
```

---

## 3. Dashboard（状態確認）

```fish
# BTC 過去 30 日の position 履歴
npx tsx scripts/live-dashboard.ts --asset=BTC-USD

# 60 日に拡張
npx tsx scripts/live-dashboard.ts --asset=BTC-USD --days=60
```

出力例:

```
| Date       | DXY    | DXYs | Fund% | Funds | Target          | Δ      | Reb |
|------------|--------|------|-------|-------|-----------------|--------|-----|
| 2026-04-24 | 104.50 | 0.30 | 0.015 | 0.38  | [██████·········] |   —    | ★   |
| 2026-04-25 | 104.30 | 0.35 | 0.012 | 0.45  | [███████········] |  4.2pp | ·   |
...
```

---

## 4. スケジューリング

### 4.1 cron (Linux)

```cron
# 毎日 UTC 00:05 に実行（Binance funding / DXY 更新直後）
5 0 * * * cd /path/to/auto-crypto-trader && /usr/local/bin/npx tsx scripts/live-signal.ts --asset=BTC-USD >> /var/log/live-signal.log 2>&1
```

### 4.2 launchd (macOS)

`~/Library/LaunchAgents/com.user.auto-crypto-trader.live.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.user.auto-crypto-trader.live</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>cd /Users/kouheikameyama/development/auto-crypto-trader && /opt/homebrew/bin/npx tsx scripts/live-signal.ts --asset=BTC-USD</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>0</integer>
    <key>Minute</key>
    <integer>5</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>/tmp/live-signal.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/live-signal.err</string>
</dict>
</plist>
```

有効化:

```fish
launchctl load ~/Library/LaunchAgents/com.user.auto-crypto-trader.live.plist
launchctl start com.user.auto-crypto-trader.live
```

---

## 5. Rebalance 時の手動執行手順 (Phase 1)

日次 `live-signal.ts` 実行で `rebalanceFlag: true` が出たら:

1. **JSON 出力を確認**: `reports/live/YYYY-MM-DD-BTC-USD.json`
2. **target position** を参照: 例 `"targetPosition": 0.45` = 45% long
3. **現状 portfolio** を確認: 自分の BTC 保有額 ÷ 総資金
4. **差分を手動で執行**:
   - target > current → BTC 買い増し
   - target < current → BTC 売却（USDT / JPY へ）
5. **執行後、次回実行で previousPosition が正しく更新**されることを確認

> Phase 2 で自動執行化の予定。現在は**手動執行**と**自動 signal 計算**の組合せ。

---

## 6. トラブルシューティング

### sidecar 落ち

```
sidecar error: fetch failed
```

→ `yfinance-service` が落ちている。再起動:
```fish
cd yfinance-service && source .venv/bin/activate && python main.py
```

### DB 接続エラー

```
PrismaClientInitializationError
```

→ `.env` の `DATABASE_URL` 確認、PostgreSQL 起動確認。

### 週末の DXY 未更新

DXY は US 営業日のみ。土日は新しい bar なしでも **forward-fill で最新値が使われる**ため signal 計算は継続可能。

### Funding が前日と同じ

Funding は 8 時間ごとに 3 回/日更新。日次平均を取る実装なので、極端な変化がない限り小さな差分に留まる。

---

## 7. Phase 2 への移行条件

Phase 1 で以下を満たしたら Phase 2 (Binance testnet 接続) を検討:

- [ ] 最低 30 日間 daily signal が止まらず動作
- [ ] Rebalance 判定の妥当性を目視確認（変動が納得できる）
- [ ] Signal 値が backtest と一貫（sampling 期間を合わせた sanity check）
- [ ] 手動執行で実際に運用することに違和感なし

満たせば Phase 2: Binance testnet API で自動執行を組む。API キー管理と security 要件が追加される。

---

## 8. 緊急時

何か想定外のことが起きたら:

1. **スケジューラ停止**: `launchctl unload` or crontab -e で該当 job 削除
2. **手動実行禁止**: daily signal 取得を止める
3. **DB 保全**: `LivePositionLog` は追記のみで過去データは触らない
4. **ログ確認**: `/tmp/live-signal.log` (launchd) or cron log
5. **復旧判断**: 原因特定後、再開 or 別の対応

**経済的被害は発生しない**（Phase 1 は execution なし）。ただし signal 記録停止は運用品質の低下。
