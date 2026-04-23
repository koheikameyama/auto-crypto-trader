# GitHub Actions + Railway Postgres Deployment

本 repo の daily live run を GitHub Actions scheduled workflow で動かし、DB は既存 Railway Postgres に別 database として同居させる。ローカル Mac 依存を解消。

## 1. 前提

- GitHub repo: [koheikameyama/auto-crypto-trader](https://github.com/koheikameyama/auto-crypto-trader)
- Railway Hobby plan が既に契約済、別サービスで Postgres instance が稼働中
- Slack workspace があり、incoming webhook を発行できる権限

## 2. セットアップ手順

### 2.1 Railway Postgres で新 database を作成

既存 Postgres に `auto_crypto_trader` という database を追加:

**Option A: Railway dashboard の Data タブから**

1. Railway project → Postgres service → **Data** タブ
2. SQL 実行 UI で以下を入力:
   ```sql
   CREATE DATABASE auto_crypto_trader;
   ```
3. 実行

**Option B: ローカル psql から**

1. Railway Postgres service の **Variables** → `DATABASE_PUBLIC_URL` をコピー
2. 末尾の DB 名を削除した URL に接続:
   ```fish
   psql 'postgresql://postgres:xxx@yyy.proxy.rlwy.net:12345/postgres' \
     -c 'CREATE DATABASE auto_crypto_trader;'
   ```

### 2.2 Public Networking を有効化

Postgres service の **Settings** → **Networking** で:
- **Public Networking**: 有効化されていること（既定で有効な場合もあり）
- `DATABASE_PUBLIC_URL` が表示されることを確認

GitHub Actions runner から接続するため public URL が必要。

### 2.3 新 database 用の接続 URL を構成

`DATABASE_PUBLIC_URL` の DB 名部分を置換:

- 元: `postgresql://postgres:PASSWORD@viaduct.proxy.rlwy.net:12345/railway`
- 新: `postgresql://postgres:PASSWORD@viaduct.proxy.rlwy.net:12345/auto_crypto_trader`

### 2.4 Slack Incoming Webhook を作成

1. Slack workspace で [Incoming Webhooks app](https://api.slack.com/apps) を追加
2. 通知を投稿したい channel を選択
3. Webhook URL（`https://hooks.slack.com/services/T.../B.../xxx`）をコピー

### 2.5 GitHub Secrets 設定

GitHub repo の **Settings** → **Secrets and variables** → **Actions** で以下を追加:

| Name | Value |
|---|---|
| `DATABASE_URL` | §2.3 で作った新 URL |
| `SLACK_WEBHOOK_URL` | §2.4 で取得した URL |

### 2.6 初回 backfill workflow を実行

1. GitHub repo の **Actions** タブ
2. 左の workflow list から **Manual Backfill (one-shot setup)** を選択
3. 右上の **Run workflow** → `main` branch で実行
4. 10-15 分で完了（6 つの backfill script を順に実行）
5. 完了後、Actions ログで全 step が✓になっているか確認

### 2.7 Daily workflow の初回手動実行

cron を待たず、すぐに 1 日分のデータを登録する:

1. **Actions** タブ → **Daily Live Run (Scheme E)**
2. **Run workflow** で手動 trigger
3. 数分で完了、Slack 通知が届くか確認

### 2.8 cron 起動確認

翌日 00:05 UTC (09:05 JST) に自動実行される。
Slack 通知が届けば OK。

## 3. 運用

### 3.1 日次確認

Slack 通知を目視するだけ。抜け漏れがあれば GitHub Actions の該当 run のログを見る。

### 3.2 手動実行

cron を待たず実行したい場合:

```bash
gh workflow run "Daily Live Run (Scheme E)"
```

または GitHub Actions dashboard から **Run workflow**。

### 3.3 履歴確認

- **GitHub Actions UI**: 過去実行ログ（90 日保持）
- **Artifact**: 各 run が `reports/live/*.json` を artifact として 30 日保存
- **Railway Postgres**: `VirtualPortfolioState` テーブルを psql / Prisma Studio で参照
- ダッシュボードは**ローカル開発機から**:
  ```fish
  # Railway Postgres を直接参照
  DATABASE_URL='<railway public url>' npx tsx scripts/live-dashboard.ts --asset=BTC-USD --days=30
  ```

## 4. ローカル運用との並行

初期 1-2 週間は **GitHub Actions と local launchd を並行稼働**して整合性を検証。

### 確認方法

両環境の `VirtualPortfolioState` をそれぞれ抽出し、日次の targetPosition / equity が一致するか比較:

```fish
# local
npx tsx scripts/live-dashboard.ts --asset=BTC-USD --days=14 > /tmp/local.txt

# Railway Postgres
DATABASE_URL='<railway public url>' npx tsx scripts/live-dashboard.ts --asset=BTC-USD --days=14 > /tmp/railway.txt

diff /tmp/local.txt /tmp/railway.txt
```

### 並行期間後の移行

問題なければローカル launchd を停止:

```fish
launchctl unload ~/Library/LaunchAgents/com.user.auto-crypto-trader.live.plist
```

## 5. トラブルシューティング

### workflow が失敗した

Slack に失敗通知が来る。Actions ログ URL から該当 run を確認。

よくある原因:
- `DATABASE_URL` secret 未設定 / URL 誤り
- Railway Postgres の Public Networking が無効化
- yfinance / CoinMetrics / Binance API の一時障害 → 翌日 retry で通常回復

### 手動 retry

Actions UI で failed run を開いて **Re-run jobs**。

### backfill 追加 / yarry-over

`Manual Backfill` を再度 workflow_dispatch で実行、idempotent (skipDuplicates) なので重複は発生しない。

### secret 更新

`DATABASE_URL` や `SLACK_WEBHOOK_URL` を Rotate したら GitHub Secrets の値を更新するだけ。workflow 変更不要。

## 6. コスト

| 項目 | 月額 |
|---|---|
| GitHub Actions (private repo 2000min free) | $0 (15min 使用 = 0.75%) |
| Railway Postgres storage 追加 (~200MB) | ~$0.05 |
| Slack webhook | $0 |
| **合計** | **~$0.05/月** |

既存 Railway Hobby credit 内に余裕で収まる。

## 7. 拡張候補

- **Slack 通知の整形**: 現状は plain text。Block Kit で表形式にすると見やすい
- **Weekly summary**: 週次で cumulative return をグラフ化（matplotlib + Slack file upload）
- **Alert threshold**: rebalance delta が大きい時のみ通知（通常日はサイレント）
- **Phase 2 移行**: Binance testnet API と接続して自動執行、別 workflow `daily-execute.yml` に分離
