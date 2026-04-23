# Round 10: GitHub Actions + Railway Postgres デプロイ

**作成日:** 2026-04-24（途中で Railway cron → GitHub Actions に方針変更）
**前提:** 既存 Railway Hobby plan の Postgres に 4.23GB 空き、GitHub repo 既設
**目的:** ローカル Mac 依存を解消、24/7 の自動 daily 実行 + Slack 通知
**コスト:** 追加 ~$0.05/月（Railway Postgres storage のみ、GitHub Actions 無料枠内）

---

## 1. アーキテクチャ

```
GitHub Actions（scheduled workflow, UTC 00:05 = JST 09:05）
  │
  ├─ ubuntu-latest runner
  ├─ Node 22 + Python 3.11 setup
  ├─ npm ci + pip install
  ├─ yfinance-service 起動（background）
  ├─ npx prisma migrate deploy
  ├─ npx tsx scripts/live-rebalance.ts --asset=BTC-USD
  ├─ npx tsx scripts/live-rebalance.ts --asset=ETH-USD
  ├─ Slack 通知 (今日の結果 summary)
  └─ exit
       │
       │ DATABASE_URL (GitHub secret)
       ↓
Railway Postgres（既存 instance、別 database `auto_crypto_trader`）
```

## 2. コスト試算

| 項目 | 月額 |
|---|---|
| GitHub Actions (private repo 2000min/月 free) | $0 (月 15 分 = 0.75% 使用) |
| Railway Postgres 追加 storage | ~$0.05 |
| Slack webhook | $0 |
| **合計** | **~$0.05/月** |

## 3. 実装ファイル

### 3.1 `.github/workflows/daily-live-run.yml`

日次 cron workflow。UTC 00:05 実行。

- actions/setup-node@v4 (Node 22)
- actions/setup-python@v5 (Python 3.11)
- Python sidecar を background で起動（`nohup python main.py &`）
- prisma migrate deploy
- live-rebalance BTC & ETH
- Slack 通知（JSON ファイル読んで整形）
- workflow_dispatch も許可（手動実行用）

### 3.2 `.github/workflows/manual-backfill.yml`

初回セットアップ用、workflow_dispatch trigger のみ。

- 5 つの backfill script を順に実行
  - backfill-crypto-prices.ts
  - backfill-onchain-metrics.ts
  - backfill-macro.ts
  - backfill-funding-rate.ts (BTCUSDT)
  - backfill-eth-funding.ts
- 10-15 分で完了

### 3.3 `docs/specs/github-actions-deployment.md`

user が Railway dashboard + GitHub secrets で設定する手順書。

## 4. Secrets（GitHub Repository Settings）

| Secret name | 内容 | 取得元 |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host.proxy.rlwy.net:port/auto_crypto_trader` | Railway Postgres の Public Networking URL を編集 |
| `SLACK_WEBHOOK_URL` | Slack Incoming Webhook URL | Slack app の Incoming Webhook から取得 |

## 5. Slack 通知設計

### Message format

```
📊 Scheme E Daily Run — 2026-04-24

*BTC-USD*
• Price: $78,203.10
• Target: 67.9% long
• Equity: $9,993.21 (-0.07%)
• Rebalanced: ✅ (fee $6.79)

*ETH-USD*
• Price: $2,376.09
• Target: 47.7% long
• Equity: $9,995.24 (-0.05%)
• Rebalanced: ✅ (fee $4.76)
```

### 実装方針

- `scripts/live-rebalance.ts` は変更せず、JSON 出力を維持
- workflow の最終 step で `jq` で両 asset の JSON をパース → Slack blocks format へ変換 → `curl -X POST $SLACK_WEBHOOK_URL`
- 失敗時も alert (非 success 時は `if: failure()` step で簡易メッセージ)

## 6. DB 切替

本番 DB を Railway Postgres に切り替えるため、環境変数 `DATABASE_URL` で制御:

- ローカル `.env`: `postgresql://kouheikameyama@localhost:5432/auto_crypto_trader?schema=public`
- GitHub Actions: secret から注入される Railway URL
- Prisma schema は共通、migration は両方で同じ state に収束

## 7. ローカル運用の扱い

**並行期間（1-2 週）**:
- ローカル Mac launchd 継続
- GitHub Actions で並行稼働
- 両 DB の VirtualPortfolioState を比較して整合性確認

**並行後:**
- ローカル launchd 停止（`launchctl unload`）
- Railway Postgres のみ運用、ローカル DB は archive

## 8. user にやってもらうこと

1. Railway dashboard で:
   - Postgres の「Data」タブ or 直接 psql で `CREATE DATABASE auto_crypto_trader;`
   - Postgres サービスの「Settings」で **Public Networking** を有効化（既に有効ならスキップ）
   - Public URL を取得（`*.proxy.rlwy.net` 系）
2. GitHub repo の Settings → Secrets で:
   - `DATABASE_URL` を設定（新 DB 用に編集した Public URL）
   - `SLACK_WEBHOOK_URL` を設定
3. Actions タブから `manual-backfill` workflow を **Run workflow** で 1 回実行（初回 backfill）
4. 翌日 09:05 JST から daily cron が自動実行

## 9. 成果物

- `.github/workflows/daily-live-run.yml`
- `.github/workflows/manual-backfill.yml`
- `docs/specs/github-actions-deployment.md`
- 既存 Railway 用設計の訂正（本 doc）

## 10. タイムボックス

| タスク | 目安 |
|---|---|
| 2 つの workflow YAML | 60分 |
| Slack 通知 step (jq + curl) | 30分 |
| 手順書 | 30分 |
| local でのテスト (act or dry-run) | 20分 |
| **合計** | **~2h** |
