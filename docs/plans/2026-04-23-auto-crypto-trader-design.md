# Auto Crypto Trader 設計ドキュメント

**作成日**: 2026-04-23
**ステータス**: 設計完了（実装未着手）
**参考**: `auto-fx-trader`（FX撤退確定リポジトリ）のフレームワークを流用

---

## 1. プロダクト概要

**Auto Crypto Trader** — 仮想通貨（BTC/ETH）のバックテスト + Walk-Forward 検証フレームワーク。

### 背景

`auto-fx-trader` で日足 × 4戦略 × 3ペア の FX 検証を実施 → 全12組合せで主KPI未達 → FX撤退確定。続いて USDJPY 4h × MA Crossover 単独の最小実験も OOS Sharpe 0.118 で FAIL。

仮想通貨は:
- 24/7市場、個人投資家比率が高い → 機関化が遅れ、エッジ残存の可能性
- 高ボラティリティ（日次5〜10%）→ Sharpe 比の統計的安定性が得やすい
- 強いトレンド性 → モメンタム戦略の学術的エビデンスあり
- BTC/ETHの長期ボラ + 急騰/急落パターン → 技術的戦略が機能する土壌

→ 同じフレームワークを適用し、**市場特性の違いで結果が変わるか**を検証。

### 目的

- **仮想通貨でエッジが観察されるか否かの実証的検証**
- FXと同じ4戦略・同じKPI・同じWF設定で比較することで、結果の差を市場特性に帰結できる
- 失敗すれば「単純な技術的戦略は市場問わず機能しない」というさらに強い結論

### スコープ

**リサーチ特化MVP**。バックテスト・Walk-Forward 検証のみ。実取引・ペーパートレード・取引所API連携は対象外。

---

## 2. 主要KPI & 判定基準

### 主KPI（FX共通基準）

| KPI | 閾値 |
|---|---|
| **OOS Sharpe** | ≥ 1.0 |

### 副KPI

| KPI | 閾値 |
|---|---|
| OOS MAR | ≥ 0.5 |
| OOS Profit Factor | ≥ 1.3 |
| OOS Max Drawdown | ≤ 30%（FXより緩和、高ボラ考慮） |
| IS→OOS Sharpe 低下率 | ≤ 30%（過学習検査） |

### 追加KPI: Buy & Hold 相対比較

- BTC/ETH の長期 Buy & Hold（ただ保有するだけ）の Sharpe/MAR を計算
- **戦略 Sharpe > Buy & Hold Sharpe** を要求
- 理由: BTC/ETH は長期で上昇しているため、単純保有でも高パフォーマンスになりうる。戦略が Buy & Hold を上回らなければ「アクティブ運用の意味なし」

### ロバスト性

- **2銘柄中1銘柄以上で主KPI達成**（FXの「3ペア中2ペア」を銘柄数スケール）

### 判定フロー

```
1. 個別バックテスト: 期待値 > 0 & PF ≥ 1.3 で1次足切り
2. WF OOS Sharpe ≥ 1.0 & 副KPI達成 → 単独合格
3. Buy & Hold 比較 → 戦略 Sharpe > BH Sharpe
4. 2銘柄中1銘柄以上で合格 → 実用化候補
5. Combined ポートフォリオで最終検証
```

---

## 3. スコープ確定事項

| 項目 | 決定値 |
|---|---|
| プロジェクト | `~/development/auto-crypto-trader`（新規リポジトリ） |
| 対象銘柄 | **BTC-USD / ETH-USD** |
| 時間軸 | 日足 |
| データソース | yfinance（`BTC-USD` / `ETH-USD`） |
| データ範囲 | BTC: 過去10年 / ETH: 過去8年（yfinance側可能な最大） |
| ポジション方向 | **ロング + ショート両方**（永久先物想定） |
| コストモデル | 往復 0.20%（片方向 0.10% × 2）、資金調達率無視 |
| サイジング | USD建て、初期 **10,000 USD**、リスク率 **1%** |
| 技術スタック | Node.js 22+ / TypeScript / Hono / Prisma / PostgreSQL / Python yfinance-service |
| 出力 | コンソール + DB + Markdownレポート |
| Web UI | 無し |

---

## 4. 戦略ポートフォリオ

**FX と完全同じ 4 戦略**（比較公平性のため）:

| # | 戦略 | タイプ | 初期パラメータ |
|---|---|---|---|
| 1 | **Donchian Breakout** | 順張り | entryPeriod=20, exitPeriod=55, atrPeriod=14 |
| 2 | **MA Crossover** | 順張り | shortEma=20, longEma=50, atrPeriod=14 |
| 3 | **RSI Mean Reversion** | 逆張り | rsiPeriod=14, buyThreshold=30, sellThreshold=70 |
| 4 | **NR7 Breakout** | ボラ圧縮→拡張 | lookback=7, atrPeriod=14 |

WF で shortEma/entryPeriod 等を最適化。

---

## 5. コストモデル

- **手数料**: エントリー/エグジットで各 0.10% を不利側に反映
  - ロング: エントリー時 `entryPrice × 1.001`, エグジット時 `exitPrice × 0.999`
  - ショート: エントリー時 `entryPrice × 0.999`, エグジット時 `exitPrice × 1.001`
- **資金調達率**: 0（無視、MVP原則）
- **スリッページ**: 0（BTC/ETH 流動性前提）

### 実装

- `applyFee(asset, side, type, rawPrice)` で統一（`type: "entry" | "exit"`）
- `calcFundingCost` 関数は定義するが常に 0 を返す（将来拡張用）
- `src/data/asset-config.ts` で feeRate を定数管理

---

## 6. ポジションサイジング

| 項目 | 値 |
|---|---|
| 初期資金 | **10,000 USD** |
| リスク率 | **1%** |
| 計算式 | `units = (equity × 0.01) / (slPrice × atrMul)` |
| レバレッジ | 1倍想定 |
| 最小単位 | バックテストでは無視（fractional許容） |

- `pip-value.ts` は不要（USD建て直接計算）
- `src/types/trade.ts` の `pnlJpy` → `pnlUsd` にリネーム

---

## 7. Walk-Forward 検証

| 項目 | 値 |
|---|---|
| isDays | 252（12ヶ月） |
| oosDays | 126（6ヶ月） |
| stepDays | 126（0.5年） |
| 期待窓数 | 約18（BTC）/ 約14（ETH） |

**FX と完全同条件**で比較可能にする。

### パラメータグリッド（FX と同じ）

| 戦略 | グリッド |
|---|---|
| Donchian | entryPeriod: [10,20,30,55], exitPeriod: [10,20,55], atrPeriod: [14] |
| MA Crossover | shortEma: [10,20,30], longEma: [50,100,200], atrPeriod: [14] |
| RSI Reversion | rsiPeriod: [7,14,21], buy: [20,25,30,35], sell: [65,70,75,80], atr: [14] |
| NR7 | lookback: [5,7,10], atrPeriod: [14] |

---

## 8. 技術スタック

| レイヤー | 技術 |
|---|---|
| Runtime | Node.js 22+ / TypeScript / Hono |
| DB | PostgreSQL + Prisma |
| 価格データ | Python + yfinance（既存 `auto-fx-trader/yfinance-service` パターン流用） |
| 技術指標 | `technicalindicators` (npm) |
| テスト | Vitest |
| Lint | ESLint |
| シェル | fish |

**yfinance-service はコピペ流用**（auto-fx-trader/yfinance-service を auto-crypto-trader/yfinance-service にコピー）。

---

## 9. アーキテクチャ

### auto-fx-trader からコピペで流用（無変更）

- `src/backtest/engine.ts`
- `src/backtest/exit-manager.ts`
- `src/backtest/position-sizer.ts`
- `src/walk-forward/` 配下全部
- `src/lib/metrics.ts`
- `src/lib/indicators/` 配下全部
- `src/core/*/` 全4戦略

### 仮想通貨向けに置き換え

| ファイル | 変更内容 |
|---|---|
| `src/types/trade.ts` | `pnlJpy` → `pnlUsd` |
| `src/types/pair.ts` → `asset.ts` | `PairSymbol` → `AssetSymbol = "BTC-USD" | "ETH-USD"` |
| `src/data/pair-config.ts` → `asset-config.ts` | BTC/ETH の feeRate=0.001、swap系削除 |
| `src/backtest/cost-model.ts` | `applySpread` → `applyFee`、`calcSwapJpy` → `calcFundingCost`（常に0） |
| `src/lib/pip-value.ts` | 削除 |
| `src/data/price-loader.ts` | yfinance の BTC-USD / ETH-USD 取得（構造は同じ） |
| `src/lib/correlation.ts` | 削除 or BTC/ETHは高相関と扱う（ポートフォリオ運用で考慮） |

### 新規追加

- `src/lib/buy-and-hold.ts` — BH Sharpe/MAR 計算ヘルパ
- `src/backtest/crypto-combined-run.ts` — BTC+ETH ポートフォリオ

### ディレクトリ構成

```
auto-crypto-trader/
├── src/
│   ├── core/                       # 4戦略（FXと同じ）
│   ├── backtest/                   # engine, exit-manager, cost-model, runner
│   ├── walk-forward/               # optimizer, engine, robustness
│   ├── lib/
│   │   ├── metrics.ts
│   │   ├── indicators/
│   │   └── buy-and-hold.ts         # NEW
│   ├── data/
│   │   ├── asset-config.ts         # NEW（pair-config相当）
│   │   └── price-loader.ts
│   ├── reports/
│   │   └── markdown-writer.ts
│   └── types/
│       ├── asset.ts                # NEW（pair.ts相当）
│       ├── bar.ts
│       ├── signal.ts
│       ├── trade.ts                # pnlUsd
│       └── strategy.ts
├── scripts/
│   ├── backfill-crypto-prices.ts
│   └── walk-forward-<strategy>.ts × 4
├── yfinance-service/               # auto-fx-trader からコピペ
├── reports/
├── prisma/
│   └── schema.prisma
└── docs/
    └── plans/
```

### Prisma スキーマ

```prisma
model Asset {
  id             String        @id @default(cuid())
  symbol         String        @unique      // "BTC-USD" / "ETH-USD"
  yfinanceTicker String        @unique
  feeRate        Float                       // 0.001 (0.10%)
  dailyBars      DailyBar[]
  trades         Trade[]
}

model DailyBar {
  // ほぼ既存のまま、pairId → assetId にリネーム
}

// BacktestRun / WalkForwardRun はほぼそのまま
// Trade は pnlJpy → pnlUsd
```

---

## 10. 検証プロセス

```
[Phase 1: セットアップ]
  新規リポジトリ、yfinance-service コピペ、Prisma スキーマ初期化

[Phase 2: データ取得]
  BTC-USD 10年、ETH-USD 8年 を DailyBar に投入

[Phase 3: 個別バックテスト（8組合せ）]
  4戦略 × 2銘柄 = 8ラン
  期待値 > 0 & PF ≥ 1.3 で1次足切り

[Phase 4: Buy & Hold ベンチマーク]
  BTC/ETH の BH Sharpe/MAR を計算、基準値として記録

[Phase 5: WF検証（8組合せ）]
  各銘柄 × 各戦略で WF
  OOS Sharpe ≥ 1.0 & 副KPI 達成 & IS→OOS低下率 ≤ 30% で単独合格
  かつ戦略 Sharpe > BH Sharpe で「アクティブ運用意味あり」

[Phase 6: ロバスト性検証]
  2銘柄中1銘柄以上で単独合格 → 実用化候補

[Phase 7: Combined ポートフォリオ]
  実用化候補の戦略で BTC+ETH Combined バックテスト

[判定]
  PASS → 仮想通貨研究継続、次フェーズ（ETH/SOL/アルト、4h足、取引所API）設計
  FAIL → 仮想通貨も撤退、単純技術戦略は市場問わず無理と確定
```

---

## 11. 期待成果物

- 8組合せ（4戦略 × 2銘柄）の個別バックテスト結果
- BTC/ETH の Buy & Hold ベンチマーク
- 8組合せの WF結果（OOS KPI + ロバスト性判定 + BH比較）
- Combined ポートフォリオ結果
- 最終判定レポート `docs/specs/research-findings.md`
- 撤退 or 継続の明確な判断

---

## 12. 所要時間見積

| フェーズ | 見積 |
|---|---|
| プロジェクト scaffold + コピペ | 1-2時間 |
| 仮想通貨向け型・コスト調整（Asset/feeRate/pnlUsd） | 1時間 |
| Buy & Hold ヘルパ + Combined | 1時間 |
| データ取得 + 全バックテスト・WF実行 | 30分（仮想通貨はレートリミットなし想定） |
| 結果分析 + レポート | 30分 |
| **合計** | **約4-5時間** |

---

## 13. auto-fx-trader との差分まとめ

| 項目 | auto-fx-trader | auto-crypto-trader |
|---|---|---|
| 市場 | FX（USDJPY/EURUSD/GBPUSD） | 仮想通貨（BTC-USD/ETH-USD） |
| 時間軸 | 日足 | 日足（同じ） |
| 戦略 | 4戦略 | 4戦略（同じ） |
| サイジング | JPY、1%リスク | USD、1%リスク |
| コスト | スプレッド + スワップ | 往復手数料 0.20% |
| ロング/ショート | 両方 | 両方 |
| KPI DD閾値 | ≤ 20% | ≤ 30%（緩和） |
| 追加KPI | なし | Buy & Hold 相対比較 |
| ロバスト性 | 3ペア中2ペア | 2銘柄中1銘柄 |
| WF窓 | 252/126/126（18窓） | 同じ（18/14窓） |
| 過学習判定 | IS→OOS ≤ 30% | 同じ |

**フレームワークは共通、市場特性差だけを変数にする**ことで、結果の差を市場に帰結できる純粋実験設計。

---

## 14. 未解決事項（実装時に決定）

- yfinance の BTC-USD / ETH-USD のタイムゾーン処理（UTC想定）
- BTC の長期データで 2013-2015 年の極端な値動き（100ドル→1000ドル）の扱い
  - 初期少量期の外れ値を除外するか、素直に含めるか
  - 推奨: 素直に含める（実際の市場履歴）
- ETH の取得開始日の確定（yfinance側の仕様次第）
- Buy & Hold の計算期間: 各銘柄の全期間 vs. WF OOS 区間だけ
  - 推奨: 両方計算（全期間は参考値、OOS区間はロバスト性比較に使用）
- Combined ポートフォリオのBTC/ETH配分: 等分 vs リスクパリティ
  - 推奨: 等分（シンプル、MVP原則）

---

## 15. 本実験の位置付け

`auto-fx-trader` の失敗（日足12組合せ FAIL + 4h最小実験 FAIL）を踏まえた**第3ラウンド**:

```
Round 1: FX 日足 × 4戦略 × 3ペア → FAIL (0/12)
Round 2: FX 4h × MA Crossover × USDJPY → FAIL (Sharpe 0.118)
Round 3: 仮想通貨 日足 × 4戦略 × BTC/ETH ← 本実験
```

Round 3 でも失敗なら「単純な技術的戦略はどの市場でも機能しない」という**決定的な結論**が得られる。
成功なら仮想通貨に本格投資する材料として有効。

いずれにせよ **4-5時間の投資で決着がつく**ため、ROI の高い実験設計。
