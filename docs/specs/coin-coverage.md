# 対応コインの方針

**作成日:** 2026-04-25
**目的:** Scheme E の対象コインを BTC/ETH 以外に拡張するかの方針と判断基準を明確化
**結論:** BTC/ETH に限定、alt 追加は **coin ごとに Round 8 style 検証必須**

---

## 1. 現在の対応範囲

| 通貨 | Virtual (記録) | Actual (実発注) | 備考 |
|---|---|---|---|
| **BTC** | ✅ | ✅ Phase 2.1 対象 | Round 7/8 で検証済、Sharpe 1.10 |
| **ETH** | ✅ | ❌ Phase 2.2+ 予定 | Round 8 で validated、Sharpe 0.85 |
| XRP, SOL, ADA, DOGE, 他 alt | ❌ | ❌ | 未検証 |

---

## 2. なぜ BTC/ETH 限定か

### Scheme E の signal が効く前提

| 入力 | BTC | ETH | 他 alt |
|---|---|---|---|
| DXY との相関 | 強 | 中 | 弱〜不明 |
| Funding rate データ | 豊富（BTCUSDT）| 豊富（ETHUSDT）| perpetual あるが流動性薄い |
| Backtest 検証 | 10 年（Round 7/8）| Round 8 で validated | **未検証** |

### 他 coin で動かない可能性のある理由

1. **Tokenomics**: SOL の inflation schedule、XRP の SEC 訴訟等、coin 固有の催事で DXY signal が上書きされる
2. **Funding 薄い**: 小口 alt の funding は少数 trader で歪みやすい → noise 多い
3. **GMO 取扱品目**: 上位 coin 対応だが spot 最小ロットが BTC/ETH より粗い場合あり

### Round 8 の実データ

```
BTC: OOS Sharpe 1.10（パラメータ wDxy=0.60, wFunding=0.40）
ETH: OOS Sharpe 0.85（同一パラメータ）
```

→ 同じ戦略でも **coin の性質差で Sharpe 25% 低下**。alt になるほど乖離が拡大するリスク。

---

## 3. 他 coin 拡張の判断基準

### 低リスク（近い将来に追加可）

- **ETH** (execution 対象): Round 8 で既に validated、Phase 2.2 Small で追加検討

### 中リスク（要検証後に判断）

| Coin | 理由 | 必要作業 |
|---|---|---|
| **SOL** | 高 cap、BTC と相関あり、funding データ存在 | 対象 coin で walk-forward backtest、相関分析（4-8 時間）|
| **BNB** | 高 cap、ただし Binance exchange token という特殊性 | 同上、かつ独立性検証 |

### 高リスク（追加推奨せず）

| Coin / カテゴリ | 理由 |
|---|---|
| XRP / DOGE / SHIB | 催事依存強い、speculative、DXY signal 効かない |
| 新興 L1（APT, SUI 等）| 歴史短い、backtest 不足 |
| ステーブル（USDT, USDC）| Scheme E の文脈では使わない（現金と等価） |

---

## 4. 対応 coin を増やす際の作業フロー

### Step 1: Round 8 style robustness 検証

- 対象 coin で walk-forward 実行（既存 `scripts/walk-forward-scheme-e-eth.ts` を流用）
- BTC と同等の OOS Sharpe（≥ 0.8 目安）が出るか
- パラメータ感度（weight 近傍 ±0.05）が BTC と同じ方向か
- 結果を `docs/specs/round-NN-findings.md` に記録

### Step 2: Multi-asset 資金配分ロジック実装

現状の課題:
- `src/live/execution-adapter.ts` は asset 単位で独立計算
- 複数 coin 同時運用すると JPY 残高の帰属が曖昧（BTC と ETH が「JPY は自分の分」と誤認）

必要な変更:
- 総 equity を計算（JPY + Σ coin × price）
- 各 coin の target = **total_equity × coin_weight × signal**
- coin_weight の設計（例: BTC 50% / ETH 50%、または signal 強度で動的配分）
- 工数: 2-3 時間

### Step 3: Phase 別展開

| Phase | 金額 | 対応 coin |
|---|---|---|
| **Phase 2.1 Micro** | ¥30K | BTC のみ（現状） |
| **Phase 2.2 Small** | ¥100K | BTC + ETH（multi-asset logic 実装後）|
| **Phase 2.3 Seed** | ¥1M | BTC + ETH、SOL 検証 PASS すれば + SOL |
| **Phase 3 Target** | 本資金 | 検証済 coin 限定、増やしすぎない |

---

## 5. 何通貨まで増やすべきか

**コインを増やすほど分散効果があるか**は戦略の性質に依存。Scheme E の場合:

- Signal（DXY + funding）は全 coin に対して **同じ方向**
  - → 同時に全 coin long 減らす／増やす
  - → **相関が高い coin 群では分散効果が限定的**
- BTC と ETH は ~0.7 の強い正相関
- 5 coin 入れても「5 倍 long/short」になるだけで diversification しない

**結論**: 2-3 coin で十分、それ以上は benefit 少なく複雑化コスト大。

---

## 6. 追加検討候補（将来の Round 13+）

| Round | 内容 | 着手条件 |
|---|---|---|
| **Round 13** | ETH 単独 weight 最適化 | Phase 2.2 Small 開始前 |
| **Round 14** | SOL 適用可能性検証 | Phase 2.3 Seed 開始前 |
| **Round 15** | Multi-coin signal（coin ごとに異なる signal）| もし単一 signal では限界 |

---

## 7. 補足: 他戦略での alt 対応

Scheme E 以外の戦略（momentum, mean-reversion, pair-trade 等）は alt で効く可能性もあるが、それは**別戦略として Round で検証**する話。

現在の auto-crypto-trader は **Scheme E 専用**として設計されているため、本 repo で alt を扱うなら:
1. Scheme E を alt でも検証して拡張する（本 doc の路線）
2. 別戦略を別スキームとして追加開発し、alt 向けに運用する

1 の方がシンプル、2 の方が表現力あるが複雑。現時点では 1 を維持。

---

## 参考

- [docs/specs/round-7-findings.md](./round-7-findings.md) — Scheme E 確定
- [docs/specs/round-8-findings.md](./round-8-findings.md) — ETH 含む robustness 検証
- [docs/specs/market-evaluation-decision.md](./market-evaluation-decision.md) — 市場評価 layer 不要の結論
- [docs/plans/2026-04-24-round-11-phase2-execution.md](../plans/2026-04-24-round-11-phase2-execution.md) — Phase 2 実装計画
