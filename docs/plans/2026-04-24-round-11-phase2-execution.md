# Round 11: Phase 2 — GMO Coin 自動執行（小額実資金）

**作成日:** 2026-04-24
**前提:** Phase 1.5 (virtual P&L) 稼働中、Scheme E の backtest 検証済（Round 7/8）
**目的:** GMO Coin API で実資金 BTC/ETH を日次 rebalance。¥10,000 から段階拡大
**スコープ:** Execution adapter 実装 + 並行運用（virtual / actual 両記録）+ 監視
**期間:** 3〜4 週間で実装、その後 1〜3 ヶ月の段階拡大

---

## 1. 目的と位置づけ

### なぜ ¥10,000 から実資金か

- **戦略リスク**は Round 7/8 backtest で 10 年以上検証済
- **執行リスク**（API 経由発注の信頼性、slippage、部分約定）は**実資金でしか検証できない**
- ¥10,000 なら bug による全損も許容範囲、早期に execution layer を鍛える方が合理的

### Virtual との関係

Virtual は**止めずに並行稼働**。Actual との比較で乖離を早期発見。

```
Scheme E signal
  ├─→ VirtualPortfolioState (simulated rebalance, 継続)
  └─→ ActualPortfolioState  (real GMO order, NEW)
```

---

## 2. アーキテクチャ

```
daily-live-run.sh (09:05 JST launchd)
  ├─ sidecar 起動
  ├─ signal 計算
  ├─ virtual rebalance (既存)
  ├─ NEW: actual rebalance via GMO API
  │   ├─ 現物残高取得
  │   ├─ target vs actual の delta 計算
  │   ├─ delta > threshold なら発注
  │   └─ 約定確認 + DB 記録
  ├─ Slack 通知（virtual + actual 両方）
  └─ sidecar 停止
```

### 新規ファイル

```
src/live/
├── signal-computer.ts              # 既存
├── portfolio-simulator.ts          # 既存
├── gmo-client.ts                   # NEW: GMO REST API client
└── execution-adapter.ts            # NEW: rebalance → 発注 → 約定確認

scripts/
├── live-rebalance.ts               # 既存（virtual）
├── live-execute.ts                 # NEW: actual 執行
└── smoke-test-gmo.ts               # NEW: 発注/キャンセルのドライラン

prisma/schema.prisma                # 追加: ActualPortfolioState, OrderLog
```

---

## 3. 新規 Prisma モデル

```prisma
model ActualPortfolioState {
  id               String   @id @default(cuid())
  asset            String   // "BTC" or "ETH" (GMO symbol)
  date             DateTime
  price            Float    // 約定 reference 価格
  targetPosition   Float    // signal から
  actualPosition   Float    // 約定後の実 portfolio 比率
  cashJpy          Float    // JPY 残高
  units            Float    // BTC/ETH 保有 units
  equityJpy        Float    // MtM 総資産
  rebalancedToday  Boolean
  rebalanceDelta   Float    // units change
  feeJpy           Float    // 実 fee（rebate は負値）
  slippageBps      Float    // (exec_price - ref_price) / ref_price * 10000
  cumulativeReturn Float
  cumulativeFeeJpy Float
  createdAt        DateTime @default(now())

  @@unique([asset, date])
  @@index([asset, date])
}

model OrderLog {
  id             String   @id @default(cuid())
  asset          String
  date           DateTime
  side           String   // "BUY" or "SELL"
  orderType      String   // "LIMIT" or "MARKET"
  requestedUnits Float
  execUnits      Float?
  requestedPrice Float?   // LIMIT のみ
  execPrice      Float?
  feeJpy         Float?
  orderId        String?  // GMO の orderId
  status         String   // "submitted" | "filled" | "partial" | "failed" | "cancelled"
  errorMessage   String?
  submittedAt    DateTime
  filledAt       DateTime?
  rawResponse    Json?    // GMO レスポンス全文（debug 用）

  @@index([asset, date])
  @@index([status, submittedAt])
}
```

**Note**: virtual は USD 建て、actual は **JPY 建て** で分離。GMO は JPY ペア取引。

---

## 4. GMO API 仕様確認ポイント

### エンドポイント（仕様書で確認、以下は想定）

- **Public**: `GET /v1/ticker` 価格取得
- **Private** (HMAC-SHA256 認証):
  - `GET /v1/account/assets` 残高
  - `GET /v1/latestExecutions` 約定履歴
  - `POST /v1/order` 発注（spot: BTC, ETH 対応）
  - `POST /v1/cancelOrder` キャンセル
  - `GET /v1/activeOrders` 未約定

### 発注仕様

- **最小発注単位**: BTC 0.0001 / ETH 0.01（要確認）
- **注文種別**: spot は指値 / 成行
- **Maker rebate**: `postOnly=true` の指値で maker 扱い（rebate 対象）
- **Rate limit**: private 毎秒 6 request（要確認）

### 認証方式

```typescript
const timestamp = Date.now().toString()
const text = timestamp + method + path + JSON.stringify(body ?? "")
const sign = crypto.createHmac("sha256", apiSecret).update(text).digest("hex")
```

---

## 5. 執行ロジック

### 日次フロー

```
signal computer → targetPositionBtc / targetPositionEth (0..1)
  ↓
getAccountBalance() → { jpy, btc, eth }
getTicker(BTC_JPY), getTicker(ETH_JPY)
  ↓
equityJpy = jpy + btc * priceBtc + eth * priceEth
targetJpyBtc = equityJpy * targetPositionBtc
currentJpyBtc = btc * priceBtc
deltaJpyBtc = targetJpyBtc - currentJpyBtc
  ↓
if |deltaJpyBtc / equityJpy| < threshold (10%) → skip
else → placeOrder(BTC, side, units)
```

### Order 戦略

1. **Maker 優先**: `postOnly=true` の指値、reference price の best bid/ask ちょうど
2. **10 秒以内に約定しなければキャンセル + 成行で再発注**（daily rebalance は急がないので maker で粘る）
3. **最小ロット未満の delta は skip**（0.0001 BTC 未満など）
4. **Slippage 記録**: 発注時 reference vs 約定価格の差を bps で記録

### 失敗時の挙動

- 発注失敗（API error, rate limit, etc.）: OrderLog に status=failed 記録、Slack alert、**その日はそれ以上触らない**（DB 状態を維持、翌日リトライ）
- 部分約定: status=partial 記録、残分は放置（翌日 rebalance で吸収）
- 約定後に整合性が崩れた場合: 次回 rebalance で自動補正

---

## 6. Stop / Alert 条件

### 自動停止（Kill switch）

以下のいずれかで **OrderLog.status=failed & 翌日以降 skip**:

- [ ] 連続 3 日の発注失敗
- [ ] Equity が initialCapital の 70% 未満（30% DD）
- [ ] API key の 401 エラー（key rotation 必要）

### Slack Alert（通常通知と別の強調）

- [ ] 発注失敗
- [ ] Slippage > 50bps
- [ ] Virtual vs Actual の累積リターン差が 2% 超
- [ ] DD > 10%（警告、停止はしない）

---

## 7. セキュリティ

- [ ] GMO API key: **取引権限のみ、出金権限なし**
- [ ] `.env` に保存、`.gitignore` 済み（既存）
- [ ] key rotation を 3 ヶ月ごとにカレンダー登録
- [ ] `scripts/smoke-test-gmo.ts` は read-only operations のみ（残高取得、ticker）

---

## 8. 実装タスク

| # | タスク | 見積 | 依存 |
|---|---|---|---|
| 1 | GMO 口座開設 + API key | ユーザー作業、1〜2 週間 | — |
| 2 | Prisma model 追加 (ActualPortfolioState, OrderLog) + migration | 30 分 | — |
| 3 | `src/live/gmo-client.ts`: REST wrapper + HMAC 認証 | 2 時間 | 1 |
| 4 | `scripts/smoke-test-gmo.ts`: 残高/ticker の read-only テスト | 30 分 | 3 |
| 5 | `src/live/execution-adapter.ts`: rebalance → 発注 → 約定確認 | 3 時間 | 3 |
| 6 | `scripts/live-execute.ts`: 日次 entry point | 1 時間 | 5 |
| 7 | Slack notify 拡張（actual 情報追加） | 30 分 | 6 |
| 8 | Stop/Alert ロジック | 1 時間 | 6 |
| 9 | `daily-live-run.sh` に live-execute 組込み（feature flag ありで段階移行） | 30 分 | 6 |
| 10 | ドライラン（¥0 で発注 → キャンセル） | 30 分 | 6 |
| 11 | ¥10,000 入金 → 実稼働開始 | 30 分 | 10 |
| 12 | 2 週間観察、virtual vs actual 比較ダッシュボード | 30 分 | 11 |
| **合計（コード）** | | **~12 時間** | |

---

## 9. ロールアウト段階

| Phase | 期間 | 金額 | 目的 |
|---|---|---|---|
| **2.0 Dry** | 1 日 | ¥0 | smoke test + ¥0 発注→キャンセル |
| **2.1 Micro** | 2 週間 | ¥10,000 | execution の信頼性確認 |
| **2.2 Small** | 1 ヶ月 | ¥100,000 | slippage / fee の実測 |
| **2.3 Seed** | 2〜3 ヶ月 | ¥1,000,000 | 長期 DD 耐性 |
| **3.0 Target** | 継続 | 目標額 | 本運用 |

各 Phase 完了条件は [`docs/specs/live-operations.md`](../specs/live-operations.md) の Gate 2/3 参照。

---

## 10. 成果物

- [ ] `prisma/schema.prisma` 更新 + migration
- [ ] `src/live/gmo-client.ts`
- [ ] `src/live/execution-adapter.ts`
- [ ] `scripts/live-execute.ts`
- [ ] `scripts/smoke-test-gmo.ts`
- [ ] `scripts/daily-live-run.sh` 更新
- [ ] `scripts/slack-notify.sh` 更新（actual 情報）
- [ ] `docs/specs/phase2-operations.md`（Phase 2 運用手順）

---

## 11. ユーザーにやってもらうこと

### Week 1-2（口座準備）
1. GMO コイン口座開設（マイナンバー + 身分証のオンライン申請）
2. 審査完了後、API key 発行（**取引権限のみ、出金権限 OFF**）
3. `.env` に `GMO_API_KEY` / `GMO_API_SECRET` を追加

### Week 3（実装完了後）
4. Smoke test 実行確認（残高取得できるか）
5. ¥10,000 を GMO 口座に入金

### Week 4（実稼働開始）
6. feature flag を ON → daily run で actual rebalance が動き出す
7. Slack 通知で virtual vs actual の乖離を daily 確認

---

## 12. リスクと mitigation

| リスク | 影響 | Mitigation |
|---|---|---|
| API spec の読み違い | 発注失敗 | smoke test で read-only 動作を先に検証 |
| 最小ロット未満で発注不可 | rebalance 実行されない | 閾値を動的に調整、最小ロット以下は skip |
| 部分約定の累積誤差 | 目標比率から乖離 | 翌日 rebalance で吸収、週次に整合性 check 追加 |
| GMO API 一時障害 | 発注失敗が複数日続く | kill switch で自動停止、Slack alert |
| Slippage が backtest 想定を超える | 実リターンが backtest 下回る | Phase 2.2 で fee/slippage 実測、必要ならモデル調整 |
| Key 漏洩 | 無断取引 | 取引権限のみ、出金不可。rotation 3 ヶ月ごと |

---

## 13. タイムボックス

| タスク | 目安 |
|---|---|
| 設計 confirm + Prisma migration | 1 時間 |
| GMO client + smoke test | 3 時間 |
| Execution adapter + live-execute | 4 時間 |
| 統合 + Slack + alert | 2 時間 |
| ドキュメント | 1 時間 |
| **合計** | **~11 時間** |

口座開設が律速（1〜2 週間）、コード実装は口座開設中に並行可能。
