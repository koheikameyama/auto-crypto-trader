# Round 4c: On-Chain Indicator Regime Filter (BTC)

**作成日:** 2026-04-23
**前提:** Round 3 / 4a / 4b で価格データのみの単純戦略は 5 回連続 FAIL。
**目的:** **オンチェーン指標を情報源として追加**し、BTC レジーム判定による BH 改善を検証。
**スコープ:** BTC のみ（ETH はオンチェーン指標の成熟度が低い & free データ少ない）

---

## 1. データ制約と指標選定

### CoinMetrics Community API 検証結果（2026-04-23）

| メトリック | 無料利用可 | 意味 |
|---|---|---|
| `PriceUSD` | ✅ | 日次 close |
| `CapMrktCurUSD` | ✅ | 時価総額 |
| `TxCnt` | ✅ | 日次トランザクション件数 |
| `AdrActCnt` | ✅ | 日次アクティブアドレス数 |
| `CapRealUSD` | ❌ 有料 | Realized Cap → MVRV 計算に必要 |
| `TxTfrValAdjUSD` | ❌ 有料 | 調整後 USD 取引高 → NVT 計算に必要 |
| `HashRate` / `DiffMean` | ❌ 有料 | マイニング指標 → Puell Multiple に必要 |

→ 古典的 MVRV / NVT / Puell は**全て無料では直接計算不可**。

### 採用する指標（無料データから合成）

1. **NVT Ratio (proxy)** = `CapMrktCurUSD / TxCnt`
   - 本来は TxTfrValAdjUSD（USD 取引高）を使うが TxCnt で代替
   - 直感: 時価総額あたりの利用度。高い = 割高、低い = 割安
   - 14日 MA で smoothing

2. **Active Address Momentum** = `AdrActCnt[t] / MA(AdrActCnt, 30)[t]`
   - ネットワーク成長率。> 1 = 拡大、< 1 = 停滞
   - Metcalfe の法則的観点でユーザー数増加は価値上昇を先行

3. **NVM Ratio** = `CapMrktCurUSD / AdrActCnt²`
   - Metcalfe 公式ベース。N² に対する過大評価検出
   - **将来オプション**（MVP では使わない、複雑化を避ける）

---

## 2. 仮説

**H3「オンチェーン活動が弱い時期は BH が危険、強い時期は BH が報われる」:**
- 単純な買い持ちは DD 80%+（2018, 2022 crash）を許容しなければならない
- NVT proxy + Active Address momentum の**組合せレジーム信号**で「投機過熱／ネットワーク停滞」を検知し cash に退避すれば、DD を抑制しつつ Sharpe 改善するはず

### H3 の強いバージョン vs 弱いバージョン

- **Strong**: Sharpe > BH の 1.1 & DD 大幅削減（< 50%） → クリアな positive result
- **Weak**: Sharpe ≈ BH だが DD < 40% → リスク調整あり。運用価値あり
- **Fail**: Sharpe < BH & DD も同程度 → オンチェーン指標も効かない、プロジェクト DONE 固定

---

## 3. 戦略仕様

### シグナル生成

1. 各日次 bar で以下を計算:
   - `nvt_proxy = CapMrktCurUSD / TxCnt` (14日 MA 化)
   - `aa_momentum = AdrActCnt / MA(AdrActCnt, 30)`
2. レジーム判定:
   - **Bullish regime**: `nvt_proxy < trailing_365d_percentile(nvt_proxy, 0.70)` AND `aa_momentum > 1.0`
   - **Bearish regime**: `nvt_proxy > trailing_365d_percentile(nvt_proxy, 0.70)` OR `aa_momentum < 0.95`
3. ポジション:
   - Bullish → フル BTC ロング
   - Bearish → 全額 cash

**Look-ahead 回避:** 各日 t の判定には過去 [t-365, t] のデータのみを使用（t 自身を含む）。`trailing_365d_percentile` は rolling 計算。

### パラメータ（WF で最適化）

| Param | Default | Grid |
|---|---|---|
| nvtLookback | 14 (MA 期間) | [7, 14, 30] |
| nvtPercentile | 0.70 (sell threshold) | [0.50, 0.70, 0.85] |
| aaLookback | 30 (MA 期間) | [14, 30, 60] |
| aaMomentumThreshold | 1.00 | [0.95, 1.00, 1.05] |
| percentileWindow | 365 (rolling window for percentile) | [180, 365, 730] |

= 3×3×3×3×3 = 243 combos（重い）。**MVP は grid を刈り込む:**
- 3×3×3×1×1 = 27 combos（`aaMomentumThreshold=1.0`, `percentileWindow=365` 固定）

### ポジションサイジング

- **All-in / All-out**: Bullish → 全資金で BTC、Bearish → 全額 cash
- リスク率 1% ベースの技術戦略とは違うモデル（BH の改善なのでこれが自然）
- 手数料: 0.10% × 2 (entry + exit) = regime transition ごと

---

## 4. 実装方針

### データ取得

**CoinMetrics Community API を Python サイドカー経由で取得:**
- 既存 `yfinance-service` に `/onchain/daily` エンドポイント追加
- Python からは `requests.get('https://community-api.coinmetrics.io/v4/timeseries/asset-metrics')` 経由
- CoinMetrics は認証不要、レート制限緩い

**DB 保存:**
- 新テーブル `OnchainMetric`:
  ```prisma
  model OnchainMetric {
    id           String   @id @default(cuid())
    assetId      String
    asset        Asset    @relation(fields: [assetId], references: [id])
    date         DateTime
    priceUsd     Float
    capMrktUsd   Float
    txCnt        Int
    adrActCnt    Int

    @@unique([assetId, date])
    @@index([assetId, date])
  }
  ```
- Backfill script: `scripts/backfill-onchain-metrics.ts`

### コード構造

```
src/
├── lib/
│   └── onchain-indicators.ts       # NEW: nvtProxy, activeAddrMomentum, rollingPercentile
├── backtest/
│   └── regime-engine.ts             # NEW: BH + regime filter (all-in/all-out)
└── walk-forward/
    └── regime-engine.ts             # NEW: WF wrapper for regime strategy
scripts/
├── backfill-onchain-metrics.ts      # NEW
└── walk-forward-onchain-regime.ts   # NEW
yfinance-service/
└── main.py                           # 修正: /onchain/daily 追加
```

### 既存 engine との関係

- Regime 戦略は **all-in/all-out**。技術戦略と本質的に違うので**別 engine**
- Metrics / WF Optimizer は流用

---

## 5. 評価基準

### 主 KPI（Round 3/4 と同じ）

| KPI | 閾値 |
|---|---|
| OOS Sharpe | ≥ 1.0 |
| OOS MAR | ≥ 0.5 |
| OOS PF | ≥ 1.3 |
| OOS Max DD | ≤ 30% |
| IS→OOS drop | ≤ 30% |

### オンチェーン固有の追加 KPI

- **vs BH**: Sharpe が BH (1.102) を上回るか
- **DD 削減**: BH の max DD (推定 80%+) と比較して有意に低いか（< 40% 目安）
- **取引回数**: レジーム遷移の頻度。50-200 が妥当（10年で）

### 判定

- **SAVED**: 主KPI + vs BH + DD < 40% → H3 採用、運用価値あり
- **IMPROVED**: Sharpe > 1.0 だが BH 未達 OR DD ≥ 40% → 部分的効果、Round 4d で refine
- **FAIL**: Sharpe < 1.0 OR 全指標 BH 以下 → H3 却下、プロジェクト DONE 再宣言

---

## 6. リスクと注意

1. **Proxy 指標の精度**: `CapMrktCurUSD / TxCnt` は古典 NVT とは違う。過去研究で使われていない指標なので、文献対応するエビデンスは弱い
2. **Cointegration bias**: PriceUSD と CapMrktCurUSD は本質的に価格から派生（CapMrktCurUSD = PriceUSD × circulating supply）→ 全 NVT/NVM 指標には**強い price component がある**。これは純粋な「別情報源」とは言えない可能性
3. **オンチェーン指標の既知の劣化**: 2020 年以降、機関化と ETF の影響で classical on-chain signals が過去より効きにくくなっている（Coingecko / Glassnode が公に認めている）
4. **生存者バイアス**: BTC は「生き残った」チェーンなので、レジーム判定が過去の BTC に特化した overfit になるリスク

### 本質的な懸念

> AdrActCnt と TxCnt は**価格と強相関**している可能性が高い。だとすれば結局「価格の smoothed 形」を別名で使っているだけで、Round 4a の SMA フィルタと本質的に同じ結果になるかもしれない。

→ Round 4c の結果次第でこの仮説を検証する。

---

## 7. タイムボックス

| フェーズ | 目安 |
|---|---|
| Python サイドカー `/onchain/daily` 追加 | 30-45分 |
| Prisma schema (`OnchainMetric`) + migration | 20分 |
| Backfill script + 実行 | 30-45分 |
| `onchain-indicators.ts` + tests | 45分 |
| `regime-engine.ts` + tests | 60-90分 |
| WF wrapper + script | 30分 |
| 実行（27 combos × 18 windows） | 10分 |
| レポート `round-4c-findings.md` | 30-45分 |
| **合計** | **約 4-5 時間** |

---

## 8. 成果物

- コード: 新規 6 ファイル（lib / backtest / WF / scripts）+ 既存修正 2 ファイル
- DB: `OnchainMetric` テーブル、BTC で 10年分 ~3,650 行
- レポート: `docs/specs/round-4c-findings.md`
- 判定: H3 採用 or 却下、プロジェクトの今後の方針決定
