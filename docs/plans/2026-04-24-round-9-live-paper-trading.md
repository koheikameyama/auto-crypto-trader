# Round 9: Live Paper Trading Infrastructure

**作成日:** 2026-04-24
**前提:** R8 で Scheme E (DXY 0.60 + Funding 0.40) が validated robust strategy として確立
**目的:** 実運用に向けた観測・記録インフラを構築。本セッションでは **execution なしの Phase 1** のみ
**想定工数:** 2-3 時間

---

## 1. 段階構成（安全のため）

| Phase | 内容 | 資金リスク | ユーザー承認 |
|---|---|---|---|
| **Phase 1（本セッション）** | 日次 signal 計算 + 記録 + dashboard + alert | なし | 不要 |
| Phase 2 (次回) | Binance testnet 接続、テストネット注文 | 実資金なし | API キー要 |
| Phase 3 (将来) | mainnet 小額運用 | あり | 厳格な設計見直し要 |

**本セッションは Phase 1 のみ**。取引所 API・credentials・実注文は扱わない。

---

## 2. Phase 1 仕様

### 2.1 Daily Signal Computation Script

`scripts/live-signal.ts`:

1. 最新 DXY 価格を yfinance-service 経由で取得（前日分 or 当日分）
2. 最新 funding rate を Binance 経由で取得（直近 24h）
3. 過去 365 日の DXY / funding 履歴を DB から読み込み
4. Scheme E weight (固定: wDxy=0.60, wFunding=0.40) で target position (0-1) を計算
5. 出力: `reports/live/YYYY-MM-DD.json`
   ```json
   {
     "date": "2026-04-24",
     "asset": "BTC-USD",
     "dxy": { "value": 104.5, "sma200": 103.2, "score": 0.3 },
     "funding": { "value": 0.00015, "pct365": 0.62, "score": 0.38 },
     "targetPosition": 0.332,
     "previousPosition": 0.35,
     "rebalanceNeeded": false,
     "weights": { "wDxy": 0.60, "wFunding": 0.40 }
   }
   ```
6. console に同じ情報を整形出力

### 2.2 Position State Tracking

新 Prisma モデル `LivePositionLog`:

```prisma
model LivePositionLog {
  id              String   @id @default(cuid())
  asset           String   // "BTC-USD"
  date            DateTime
  dxyValue        Float
  dxyScore        Float
  fundingValue    Float
  fundingScore    Float
  targetPosition  Float
  previousPosition Float?
  rebalanceFlag   Boolean
  notes           String?
  createdAt       DateTime @default(now())

  @@unique([asset, date])
  @@index([asset, date])
}
```

日次 signal 実行ごとに 1 行 insert。過去の判定を監査可能に。

### 2.3 Dashboard CLI

`scripts/live-dashboard.ts`:
- 過去 30 日の `LivePositionLog` を表形式で表示
- Position 変化グラフ（ASCII art or 単純な数値表）
- Rebalance 発生日のハイライト
- 現在の signal 構成の表示

### 2.4 Alert Structure

Phase 1 ではファイル/stdout のみ。ただし拡張可能な構造にする:
- `rebalanceFlag = true` のとき alert 対象
- 出力は JSON なので外部ツール（cron + curl → Slack webhook 等）で処理可能
- Phase 2 以降で実際の Slack/email 連携を実装

### 2.5 スケジューリング ドキュメント

`docs/specs/live-operations.md`:
- launchd (macOS) / cron 例
- 推奨実行時刻: UTC 00:05（日次 funding / DXY 更新直後）
- エラー時の挙動（exit code、log）
- 前日と同じ signal でも log を残す

---

## 3. 実装方針

### 使う / 使わないもの

**使う:**
- 既存 `fetchFundingDaily` / `fetchMacroDaily` (live でも履歴でも同じ)
- 既存 DB (`MacroBar`, `FundingRate`)
- 既存 `weighted-ensemble-engine` の signal 計算ロジック（引数化して再利用）

**新規:**
- `scripts/live-signal.ts` (日次実行 entry point)
- `scripts/live-dashboard.ts` (観測 CLI)
- `src/live/signal-computer.ts` (engine から signal 計算ロジックを抽出)
- `prisma/schema.prisma` + migration: `LivePositionLog`

---

## 4. 明示的に「やらないこと」

- Binance / Bybit API との注文送信接続
- API キーの管理・保存
- 実資金の動き
- Slack/email 直接送信（構造だけ用意）
- 複数 asset の同時観測（BTC のみ）
- Weight の自動再最適化

Phase 2 以降で扱う。

---

## 5. 判定と成果物

### 本セッションの完了基準

1. `live-signal.ts` が実行でき、今日の signal JSON を出力する
2. `LivePositionLog` に今日の row が insert される
3. `live-dashboard.ts` が過去実行履歴を表示する（初回は 1 行のみだが OK）
4. エラーなく実行完了、type-check green、tests green

### 成果物

- コード: 3 files + migration
- DB: `LivePositionLog` table
- 初回実行: `reports/live/2026-04-24.json` 1 件
- ドキュメント: `docs/specs/live-operations.md` (運用手順)

---

## 6. 次ステップ (Phase 2 以降)

Phase 1 完了後に検討:

### Phase 2: Binance Testnet 接続
- API キー管理（env var、暗号化、.gitignore 徹底）
- Testnet endpoint: `https://testnet.binancefuture.com`
- 架空資金で実際のリバランスをシミュレート
- 1-3 ヶ月 testnet 運用

### Phase 3: Mainnet 小額運用
- 初期資金 $100-1000 レベル
- 厳格な position サイズ制限
- 緊急停止メカニズム
- 月次レビュー

### Phase 2/3 の設計は本セッションでは扱わない

---

## 7. タイムボックス

| タスク | 目安 |
|---|---|
| Prisma model + migration | 10分 |
| signal-computer.ts (engine 抽出) | 30分 |
| live-signal.ts | 30-45分 |
| live-dashboard.ts | 20分 |
| docs/live-operations.md | 20分 |
| 初回実行 + 動作確認 | 10分 |
| **合計** | **約 2h** |
