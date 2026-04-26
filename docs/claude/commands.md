# よく使うコマンド

## Local 開発

```fish
# 型チェック
npx tsc --noEmit

# Prisma migration（local）
npx prisma migrate dev --name <change>
npx prisma studio   # local DB GUI

# GMO API 疎通確認（read-only）
set -a && . ./.env && set +a
npx tsx scripts/smoke-test-gmo.ts

# Live 実行（手動、ローカル）
npx tsx scripts/live-rebalance.ts --asset=BTC-USD
npx tsx scripts/live-execute.ts --asset=BTC --dry-run

# Compare dashboard
npx tsx scripts/compare-dashboard.ts --asset=BTC --days=14
```

## Workflow trigger（GitHub Actions）

```fish
# Daily live run
gh workflow run daily-live-run.yml --repo koheikameyama/auto-crypto-trader

# Daily data collection
gh workflow run daily-data-collection.yml --repo koheikameyama/auto-crypto-trader

# Migrate（push to prisma/ で自動発火、または手動）
gh workflow run migrate.yml --repo koheikameyama/auto-crypto-trader
```

## 状態確認

```fish
# 直近の workflow run
gh run list --repo koheikameyama/auto-crypto-trader --limit 5

# Railway DB の最新 portfolio state
psql 'postgresql://postgres:...@shinkansen.proxy.rlwy.net:45444/railway' -c '
  SELECT date::date, asset, "actualPosition", "equityJpy", "rebalancedToday"
  FROM auto_crypto_trader."ActualPortfolioState"
  ORDER BY date DESC LIMIT 5;
'

# OrderLog（直近の発注履歴）
psql ... -c '
  SELECT to_char("submittedAt" AT TIME ZONE '\''Asia/Tokyo'\'', '\''MM-DD HH24:MI'\''), side, "orderType", status, "execUnits", "feeJpy"
  FROM auto_crypto_trader."OrderLog"
  ORDER BY "submittedAt" DESC LIMIT 10;
'

# Healthchecks 状態
curl -fsS 'https://hc-ping.com/2964ba3b-cd35-4205-9bbc-9323bdec0816'
```

## 緊急停止

```fish
# Phase 2 actual execution を OFF（virtual は継続）
echo -n 'false' | gh secret set EXECUTION_ENABLED --repo koheikameyama/auto-crypto-trader

# 完全 OFF（virtual も止める）
gh workflow disable daily-live-run.yml --repo koheikameyama/auto-crypto-trader

# 復帰
echo -n 'true' | gh secret set EXECUTION_ENABLED --repo koheikameyama/auto-crypto-trader
gh workflow enable daily-live-run.yml --repo koheikameyama/auto-crypto-trader
```

## cron-job.org 操作

```fish
# .env から API key を取得（注意: source は line 17 の quote エラーで失敗するので awk で抽出）
CRONJOB_KEY=$(awk -F= '/^CRONJOB_API_KEY=/{sub(/^CRONJOB_API_KEY="?/,"");sub(/"$/,"");print}' .env)

# Job 一覧
curl -sS -H "Authorization: Bearer $CRONJOB_KEY" https://api.cron-job.org/jobs | jq '.jobs[] | {jobId, title, enabled}'

# Job を手動実行
curl -sS -X POST -H "Authorization: Bearer $CRONJOB_KEY" https://api.cron-job.org/jobs/<jobId>/run

# Job を一時無効化
curl -sS -X PATCH \
  -H "Authorization: Bearer $CRONJOB_KEY" \
  -H "Content-Type: application/json" \
  -d '{"job":{"enabled":false}}' \
  https://api.cron-job.org/jobs/<jobId>
```

## Linear 連携

PR 作成時、本文に `Fixes KOH-XX` を必ず記載 → マージで自動 close。

主要タスク:
- 親: [KOH-431](https://linear.app/koheikameyama/issue/KOH-431) Round 11 Phase 2
- アクティブ: [KOH-442](https://linear.app/koheikameyama/issue/KOH-442) Phase 2.1 Micro（due 2026-05-09）
- 次: [KOH-444](https://linear.app/koheikameyama/issue/KOH-444) Round 12 Fee 再最適化（due 2026-05-16）
