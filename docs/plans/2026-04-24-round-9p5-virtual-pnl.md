# Round 9 Phase 1.5 — Virtual P&L Tracking

**作成日:** 2026-04-24
**前提:** R9 Phase 1 で live-signal が日次実行可能。exchange 接続なし、手動 rebalance 想定
**目的:** 実資金なしで「Scheme E を運用していたら累積リターン・DD はどうなるか」を日次追跡するシミュレーション層を追加
**意義:** Phase 2 (testnet) / Phase 3 (mainnet) に進む前の confidence building。数ヶ月運用データを蓄積

---

## 1. 仕様

### 追加する仮想ポートフォリオ状態

- **初期資金**: CLI 引数 or config (default $10,000)
- **状態**:
  - `cashUsd`: 現金残高
  - `btcUnits`: 保有 BTC units
  - `ethUnits`: 保有 ETH units（ETH も運用する場合）
  - `equityUsd`: MtM 総資産 = cash + btcUnits × btcPrice

### 日次フロー

1. `live-signal.ts` で target position 計算（既存）
2. **新規**: 最新 BTC/ETH price を取得
3. **新規**: 前日の状態を DB から読む
4. **新規**: rebalance 実行:
   - target vs current の delta を計算
   - fee を適用（delta × feeRate）
   - cash / btcUnits を更新
5. **新規**: 新しい equity を計算して DB に保存

### 新 Prisma モデル

```prisma
model VirtualPortfolioState {
  id               String   @id @default(cuid())
  asset            String   // "BTC-USD" or "ETH-USD"
  date             DateTime
  price            Float    // その日の asset 価格 (close)
  targetPosition   Float    // 0..1
  actualPosition   Float    // rebalance 後の実際の割合 (threshold により target と異なる場合あり)
  cashUsd          Float
  units            Float
  equityUsd        Float
  rebalancedToday  Boolean
  rebalanceDelta   Float    // units change
  feeUsd           Float    // today の rebalance fee
  cumulativeReturn Float    // (equity / initialCapital) - 1
  cumulativeFee    Float    // 通算 fee
  createdAt        DateTime @default(now())

  @@unique([asset, date])
  @@index([asset, date])
}
```

---

## 2. 実装

### ファイル構成

```
scripts/
├── live-signal.ts           # 既存、signal 計算のみ
├── live-rebalance.ts        # NEW: signal に基づき virtual portfolio を更新
└── live-dashboard.ts        # 拡張: equity curve / total return / DD 追加

src/live/
├── signal-computer.ts       # 既存
└── portfolio-simulator.ts   # NEW: rebalance ロジック

prisma/schema.prisma         # 追加: VirtualPortfolioState
```

### `live-rebalance.ts` の役割

1. 今日の signal を `live-signal.ts` に任せる（または内部で computeLiveSignal を呼ぶ）
2. 前日の VirtualPortfolioState を取得
3. 今日の BTC price を yfinance 経由で取得
4. `portfolio-simulator.ts` で rebalance を実行
5. 新しい状態を DB に保存 + JSON 出力

### `portfolio-simulator.ts` の責務

既存の `weighted-ensemble-engine.ts` の rebalance ロジックを**単一日次版**に抽出:

```typescript
interface SimulatorInput {
  asset: "BTC-USD" | "ETH-USD";
  price: number;           // 今日の close
  targetPosition: number;  // 0..1
  prev: {
    cashUsd: number;
    units: number;
  } | null;
  initialCapital: number;  // prev が null のとき使用
  rebalanceThreshold: number;
}

interface SimulatorOutput {
  cashUsd: number;
  units: number;
  equityUsd: number;
  actualPosition: number;
  rebalancedToday: boolean;
  rebalanceDelta: number;
  feeUsd: number;
}
```

---

## 3. Dashboard 拡張

既存 `live-dashboard.ts` に equity column を追加:

```
| Date       | Price   | Target | Actual | Equity   | Return  | DD    | Reb |
|------------|---------|--------|--------|----------|---------|-------|-----|
| 2026-04-23 | $95,000 | 67.9%  | 67.9%  | $10,000  | +0.0%   | 0.0%  | ★   |
| 2026-04-24 | $96,500 | 70.2%  | 67.9%  | $10,101  | +1.0%   | 0.0%  | ·   |
| 2026-04-25 | $93,000 | 65.5%  | 67.9%  | $ 9,876  | -1.2%   | 2.2%  | ·   |
...
```

Summary に追加:
- 開始日 / 現在日
- 初期資金 / 現在 equity
- 累積 return / 年率換算 / MaxDD
- 累積 fee
- Rebalance 回数

---

## 4. 運用フロー (Phase 1.5)

```fish
# 日次実行（signal + virtual portfolio 更新の組み合わせ）
npx tsx scripts/live-rebalance.ts --asset=BTC-USD --initial-capital=10000

# または従来通り signal のみ（virtual portfolio 更新しない）
npx tsx scripts/live-signal.ts --asset=BTC-USD

# ダッシュボード（equity curve 表示）
npx tsx scripts/live-dashboard.ts --asset=BTC-USD --days=30
```

**初回実行**: 初期資金を「全額 cash から開始」とし、初日 target に合わせて一気に rebalance。

---

## 5. Phase 2 への自然な拡張

Phase 1.5 で出来上がった `portfolio-simulator.ts` は **Phase 2 の骨組みにそのまま流用可能**:

- Phase 1.5: simulated rebalance → DB 記録のみ
- Phase 2: Binance testnet に同じロジックで order 送信
- Phase 3: mainnet に同じロジックで order 送信

つまり Phase 1.5 は Phase 2 への**土台作り**でもある。

---

## 6. 成果物

- コード:
  - `prisma/schema.prisma`: `VirtualPortfolioState` モデル + migration
  - `src/live/portfolio-simulator.ts`: rebalance ロジック
  - `scripts/live-rebalance.ts`: 日次 entry point（simulator 版）
  - `scripts/live-dashboard.ts` 拡張
- レポート: 実行ごとに `reports/live/YYYY-MM-DD-<asset>-portfolio.json`
- ドキュメント: `live-operations.md` に Phase 1.5 のセクション追加

---

## 7. タイムボックス

| タスク | 目安 |
|---|---|
| Prisma model + migration | 10分 |
| portfolio-simulator.ts | 30分 |
| live-rebalance.ts | 30分 |
| dashboard 拡張 | 20分 |
| 運用 doc 更新 | 15分 |
| 初回実行テスト | 15分 |
| **合計** | **約 2h** |
