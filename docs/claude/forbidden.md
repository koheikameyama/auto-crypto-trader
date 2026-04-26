# ❌ やってはいけないこと

過去に事故が起きた / 設計上禁忌な操作のリスト。

| # | 禁止事項 | 理由 |
|---|---|---|
| 1 | Scheme E のパラメータを backtest 検証なしに変更 | 戦略の Sharpe / DD 保証が崩れる |
| 2 | `prisma migrate resolve --applied` | 過去 2 度事故、SQL 実行されず履歴だけ進む |
| 3 | `prisma db push` | 履歴が残らない、Railway 反映時に diff 不能 |
| 4 | `gh secret set --body -` | literal `-` が保存される（実例あり）。stdin リダイレクト使う |
| 5 | GMO API key の出金権限 ON | key 漏洩時に資金流出 |
| 6 | Multi-asset 配分ロジック未実装で `EXECUTION_ASSETS=BTC,ETH` | BTC/ETH が JPY を独立に主張して過剰発注 |
| 7 | Round 11 計画外の "ついで" 改善 | Phase 2 の baseline が変わり virtual/actual 比較破綻 |
| 8 | 実発注 logic 変更後に dry-run なしで本番投入 | 重複発注・ロット計算ミスで損失 |
| 9 | Kill switch の閾値を緩める | 暴落時の自動停止が機能しない |
| 10 | DATABASE_URL に `?schema=auto_crypto_trader` を付け忘れ | public schema（別 project）にテーブル作成しかねない |
