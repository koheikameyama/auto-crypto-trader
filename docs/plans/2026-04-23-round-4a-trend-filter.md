# Round 4a: Trend-Filtered Strategies（簡易検証）

**作成日:** 2026-04-23
**前提:** Round 3 で 4戦略 × 2銘柄 = 8 組合せすべてが WF FAIL
**目的:** 既存の 4 戦略に **200日SMA トレンドフィルタ** を適用することで救えるか最小コストで検証
**期待工数:** 2-3 時間（既存フレームワーク流用）

---

## 1. 仮説

Round 3 の失敗には複数の説明仮説がある。最も単純で検証コストが低いものから:

**仮説 H1「カウンタートレンドの損失が累積」:**
- BTC/ETH は長期上昇トレンド市場。逆張り（RSI）や逆方向ブレイクアウト（Donchian 下抜け）は「大きなトレンドに飲まれる」
- 200日SMA の向きでフィルタすれば、カウンタートレンド取引を全排除できる
- ロング条件: `close > SMA200` のときのみ long signal 採用、short signal は捨てる
- ショート条件: `close < SMA200` のときのみ short signal 採用、long signal は捨てる

**H1 が正なら:**
- trade count が減り、win rate 上昇、max DD 低下
- OOS Sharpe 改善 → 戦略救済の余地あり

**H1 が誤なら:**
- フィルタしても Sharpe 低位 → **「単純な技術的戦略は regime filter でも救えない」**という追加データポイント
- 次の方向性（ペアトレード / オンチェーン）へ移行する根拠が強まる

---

## 2. スコープ

- **対象戦略**: 既存 4 戦略 (donchian / ma-crossover / rsi-reversion / nr7-breakout) 全て
- **対象銘柄**: BTC-USD / ETH-USD（データ再利用）
- **期間**: 10年（Round 3 と同じ）
- **WF 設定**: 365 / 182 / 182 日（Round 3 と同じ）
- **初期資金**: 10,000 USD、リスク率 1%（Round 3 と同じ）
- **フィルタ**: **SMA 200日固定**（新パラメータを追加しない = 過学習回避）
- **funding rate**: 0%（MVP）、必要あれば感度分析

### 対象外
- 別のフィルタ（EMA、ATR バンド、VIX など）は試さない
- ペアトレード、オンチェーン等の**異質な戦略クラス**は Round 4b 以降
- SMA 期間の WF 最適化は行わない（H1 の検証にならなくなる）

---

## 3. 実装方針

### ファイル構成

```
src/
├── lib/
│   └── trend-filter.ts         # NEW: SMA + filterEntrySignals
├── core/
│   ├── donchian/
│   │   └── index.ts            # 既存 (無変更)
│   └── wrapped/                # NEW
│       ├── donchian-tf.ts
│       ├── ma-crossover-tf.ts
│       ├── rsi-reversion-tf.ts
│       └── nr7-breakout-tf.ts
scripts/
├── walk-forward-donchian-tf.ts  # NEW
├── walk-forward-ma-crossover-tf.ts
├── walk-forward-rsi-reversion-tf.ts
└── walk-forward-nr7-tf.ts
```

### core 側の設計

```typescript
// src/lib/trend-filter.ts
export function simpleMovingAverage(bars: DailyBar[], period: number): (number | null)[];

// signal.date の時点での SMA 値に基づいて、順トレンド方向だけ残す
export function filterEntrySignalsByTrend(
  bars: DailyBar[],
  signals: EntrySignal[],
  smaPeriod: number,
): EntrySignal[];
```

### wrapped 戦略の設計

各 wrapped 戦略は元戦略の `generateSignals` をラップし、同じ Strategy<P> 型を満たす:

```typescript
// src/core/wrapped/donchian-tf.ts
export const donchianTrendFilteredStrategy: Strategy<DonchianParams> = {
  name: "donchian-tf",
  defaultParams: donchianStrategy.defaultParams,
  exitConfig: donchianStrategy.exitConfig,
  generateSignals(bars, asset, params) {
    const raw = donchianStrategy.generateSignals(bars, asset, params);
    return filterEntrySignalsByTrend(bars, raw, 200);
  },
};
```

### WF script の設計

既存 `scripts/walk-forward-donchian.ts` のコピー。戦略の import 先だけ差し替え。グリッドは元戦略と完全同一（SMA 期間は触らない）。

---

## 4. 評価基準

Round 3 と完全に同じ KPI 表を作成し、**行ごとに救済されたか比較**:

| 戦略 | 銘柄 | Round 3 OOS Sharpe | **Round 4a OOS Sharpe** | 差分 | 救済判定 |
|---|---|---|---|---|---|
| donchian | BTC | 0.797 | ? | ? | ? |
| donchian | ETH | 0.745 | ? | ? | ? |
| ma-crossover | BTC | 0.333 | ? | ? | ? |
| ... | | | | | |

**救済判定:**
- **SAVED**: OOS Sharpe ≥ 1.0 & IS→OOS drop ≤ 30% & Sharpe > BH
- **IMPROVED**: Sharpe が Round 3 比で +0.3 以上上昇（閾値未達でも傾向あり）
- **NO EFFECT**: ±0.3 以内
- **WORSE**: -0.3 以上悪化

### 全体判定

- 8 組合せ中 **1 組合せでも SAVED** → Round 4a 成功、フィルタ戦略で続行価値あり
- **0 組合せ SAVED だが 3+ 組合せ IMPROVED** → フィルタに効果の片鱗あり、パラメータ変えて再検証
- **ほぼ NO EFFECT** → **仮説 H1 却下** → Round 4b（ペアトレード or オンチェーン）へ

---

## 5. リスクと注意

### 既知の落とし穴

1. **SMA200 の warm-up**: 各 WF 窓の IS は 365 バーなので 200 バー使うと先頭に null が多い。対策: フィルタは**全期間 bars から SMA 計算** → signals に対して適用（戦略の generateSignals と同じ `bars` を参照）
2. **BE 判定後の追跡**: フィルタは**エントリー時のみ**。保有中に SMA 割れても exit はしない（既存 exit-manager に任せる）
3. **SMA200 は「後知恵」か?**: signal.date の時点での SMA 値は、その時点までの close から計算しているので look-ahead bias なし
4. **テスト片寄り**: SMA200 を過ぎるほど下落した市場（2018年、2022年）では取引数激減の可能性。trade count も観察する

### やらないこと

- フィルタのパラメータ最適化（WF で SMA 期間を最適化すると本来の過学習再現になる）
- 3つ以上のフィルタ組合せ
- エントリーだけでなく exit もフィルタ化する設計

---

## 6. 成果物

- コード: `src/lib/trend-filter.ts`、`src/core/wrapped/*.ts` × 4、WF scripts × 4
- テスト: trend-filter.ts の単体テスト（warm-up 処理、frontier case）、各 wrapped strategy の smoke test
- 実行: 4 戦略 × 2 銘柄 = 8 WF run、DB に `*-tf` 命名で保存
- レポート: `docs/specs/round-4a-findings.md`
  - 上記 §4 比較表
  - 全体判定
  - Round 4b への推奨事項

---

## 7. タイムボックス

| フェーズ | 目安 |
|---|---|
| trend-filter.ts + tests | 30-45分 |
| wrapped strategies × 4 + tests | 20分 |
| WF scripts × 4 | 15分 |
| WF 実行（4 戦略 × 2 銘柄） | 10-30分（RSI 重い） |
| 比較レポート作成 | 30-45分 |
| **合計** | **約 2-3 時間** |

設計がシンプル（既存フレームワーク 100% 流用）なので見積もり確度は高い。
