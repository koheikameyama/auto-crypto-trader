# 作業ルール

## 戦略パラメータの変更

**Scheme E のパラメータ（wDxy=0.60, wFunding=0.40, threshold 10%, lookback 365 等）は安易に変更しないこと。**

- Round 7/8 で walk-forward 最適化済
- 変更すると Phase 2 の virtual/actual 比較が崩れる
- 変更したい場合は新 Round として backtest 再実行 + plan ドキュメント作成が必須

## 実発注関連の変更

`src/live/execution-adapter.ts` の発注ロジックを変更する場合:

1. 必ず Phase 2.0 Dry を**最小ロットで再実行**して動作確認
2. `--dry-run` モードでまず計算検証
3. OrderLog の整合性を破壊する変更は禁止（idempotent UPSERT を保つ）
4. Kill switch logic の弱体化は禁止

## Migration

- **`prisma migrate dev --name <変更内容>`** を必ず使う
- `prisma db push` は禁止（履歴が残らない）
- `prisma migrate resolve --applied` は **絶対に使わない**（過去 2 度事故）
- Migration ファイルは必ず commit

## Secret 管理

- `.env` は `.gitignore` 済（ローカル開発用）
- 本番は GitHub Secrets:
  - `DATABASE_URL` (Railway Postgres、`?schema=auto_crypto_trader`)
  - `SLACK_WEBHOOK_URL`
  - `GMO_API_KEY` / `GMO_API_SECRET`（取引権限のみ、出金 OFF）
  - `EXECUTION_ENABLED` (true/false)
  - `EXECUTION_ASSETS` (BTC or BTC,ETH)
  - `HEALTHCHECKS_URL`
- `gh secret set` 使用時の注意: `--body -` フラグは使わない（バグで literal `-` が保存される）。stdin から `gh secret set NAME < file` を使う

## テスト & 動作確認

- TypeScript: `npx tsc --noEmit` で型チェック必須（commit 前）
- 実発注を伴う変更: smoke test → dry-run → 最小ロット実約定の順で検証
- Migration: ローカル先 → Railway（GitHub Actions の migrate workflow が自動適用）
