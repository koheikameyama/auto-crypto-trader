# Market Evaluation（市場評価レイヤ）要否の決定

**作成日:** 2026-04-25
**背景:** sibling project [auto-stock-trader](../../../auto-stock-trader) が `market-assessment` job で VIX / breadth / CME divergence / drawdown の 5 軸マーケット評価を日次で行い、結果に応じて全取引を停止させる仕組みを持つ。auto-crypto-trader にも同等の layer を追加すべきか検討。
**結論:** **追加不要**。Scheme E 自体が market evaluation の機能を内包しているため。

---

## 1. auto-stock-trader の市場評価

### 実装

- **Entry point**: [auto-stock-trader/src/jobs/market-assessment.ts](../../../auto-stock-trader/src/jobs/market-assessment.ts) (330 行)
- **Cron**: 毎朝 8:00 JST、月〜金（`.github/workflows/cronjob_morning-analysis.yml`）
- **DB**: `MarketAssessment` テーブルに日次記録

### 5 つの判定軸

| Signal | 役割 | Data | 出力 |
|---|---|---|---|
| **VIX regime** | ボラ状況による position size 調整 | VIX 先物価格 | normal / elevated / high / crisis |
| **Market breadth** | 相場内部の健全性 | JP 株 25-SMA 上回り % | 55〜80% 帯、帯外なら skip 扱い |
| **CME pre-market divergence** | 寄付前ギャップリスク | CME NKD=F + USD/JPY | −3% 超で kill switch |
| **Nikkei SMA(25) filter** | トレンド regime | 日経 225 | above/below で position 縮小判断 |
| **Drawdown circuit breaker** | 累積損失ガード | 週次/月次 PnL 履歴 | 閾値超で全取引停止 |

### 作用

- `shouldTrade=false` → その日の entry 生成を **0 銘柄**に強制
- `isShadowMode=true` → スコアリング継続、発注停止（学習用）
- Slack / DB / ログに理由を明記

### 位置づけ

取引判断とは **独立した gate**。assessment → watchlist-builder → scanner → trade の pipeline で最前段に存在。

---

## 2. auto-crypto-trader のリスク構造の違い

### 株と暗号通貨の構造比較

| 観点 | 株（auto-stock-trader） | 暗号通貨（auto-crypto-trader） |
|---|---|---|
| **取引頻度** | Intraday、日に複数回 entry/exit | **日次 1 回 rebalance** |
| **ポジションサイジング** | trade ごとに個別（score→size） | target position `0..1` の連続値 |
| **マーケット構造** | open/close あり、pre-market ギャップ、板薄時間帯 | **24/7 連続**、ギャップなし |
| **銘柄選定** | 日次 watchlist、scanner で絞込み | **固定（BTC / ETH のみ）** |
| **regime 情報の源泉** | VIX / breadth / CME divergence 等（外部） | **DXY / funding rate**（Scheme E の入力そのもの） |
| **Intraday 強制 exit** | VIX≥30 で end-of-day exit 有 | **不要**（そもそも intraday 発注しない） |
| **Overnight gap risk** | 大（前日の CME で予兆） | **ない**（24/7） |

### auto-stock-trader で市場評価が必要な理由

1. **Pre-market gap risk**: CME 先物と寄付のズレで寄底暴落 → 寄り前に halt 判断必要
2. **Intraday vol spike**: VIX 急騰で entry 禁止 or 強制 exit
3. **Breadth collapse**: 相場全体崩れ始めた時に new entry 抑止
4. **銘柄選定の前段階**: regime 荒れた日に watchlist を空にする

いずれも **連続的な signal 計算と別の、discrete な gate** が必要。株のマーケット構造と entry 設計が根拠。

---

## 3. Scheme E が market evaluation を内包している

Scheme E（Round 7 で確定した 2-signal weighted ensemble）:

```
target_position = 0.60 × DXY_score  +  0.40 × Funding_score
                  ~~~~~~~~~~~~~~~~~     ~~~~~~~~~~~~~~~~~~~~~
                  マクロ risk 指標       市場 positioning 指標
```

### 対応関係

| 株の市場評価 | Scheme E の対応 | 効果 |
|---|---|---|
| VIX regime（ボラ） | DXY score（USD 強弱 = risk-on/off proxy） | DXY 上昇 → target 下げ → de-risk |
| Market breadth（内部健全性） | Funding score（positioning 過熱度） | Funding 高騰 → target 下げ → de-risk |
| Kill switch（閾値超で停止） | target_position → 0 に自然低下 | 極端 state で position 縮小 |

つまり **「regime 評価」と「position 計算」を一つの式に融合**しているのが Scheme E の特徴。

### backtest による妥当性

- Round 7 / Round 8 で 10 年以上の期間検証済
- OOS Sharpe 1.096、Max DD 想定内
- 極端な regime（COVID, 2022 crypto winter, LUNA crash 等）を含む

→ 株の market assessment に相当する判断は**既に signal 計算の中で行われている**。

---

## 4. 既存の安全装置

株の drawdown circuit breaker / CME 緊急停止に相当する layer は別途実装済:

### [src/live/kill-switch.ts](../../src/live/kill-switch.ts)

#### 停止条件（Kill switch）
- 連続 3 日の発注失敗
- ActualPortfolioState の cumulative return ≤ −30%
- API 認証エラー（401/403）

#### Alert 条件（停止せず Slack 通知のみ）
- slippage > 50bps
- virtual vs actual cumulative return 乖離 > 2pp
- DD > 10%

### 位置づけ
- 戦略 signal とは独立
- 主に execution / operation レベルの異常検知
- 株でいう drawdown circuit breaker に相当

---

## 5. 判断

| 質問 | 答え |
|---|---|
| 市場評価 layer 必要？ | **Scheme E が兼ねているので不要** |
| auto-stock-trader の実装を移植すべき？ | **NO**。取引構造が異なるため別物 |
| Phase 2.1 Micro で十分？ | **YES**（Scheme E + kill switch で足りる）|

---

## 6. 将来的な強化候補（Phase 3 以降、優先度低）

必須ではないが、大資金運用時に検討する価値のある追加 layer:

| 候補 | 目的 | 実装難度 | 採用条件 |
|---|---|---|---|
| **DVOL（Deribit BTC IV）** | tail risk proxy、IV 急騰で追加の de-risk | 中（Deribit API 必要） | Scheme E が捉えきれない short-horizon vol spike を経験したら |
| **Exchange health check** | GMO API 障害検知で skip | 低（ticker latency / error rate 監視） | Phase 2 の段階で 2-3 日続く障害に遭遇したら |
| **BTC / DXY 相関 break 検知** | 相関切れ時に signal 信頼度を下げる | 中 | Scheme E の前提が崩れる regime change 時 |
| **週末・祝日別 rebalance 閾値** | 流動性薄い時間帯は rebalance 見送り | 低 | 実運用で週末の slippage 問題が顕在化したら |
| **Funding rate 異常値 filter** | squeeze 相場で funding が normal range 外の時は signal 無視 | 低 | backtest で funding 外れ値日の PnL を検証後 |

いずれも **Phase 2.2〜3 で実データを見てから判断**。現時点では over-engineering になるので着手しない。

---

## 7. 参考

- [docs/specs/round-7-findings.md](./round-7-findings.md): Scheme E 確定
- [docs/specs/round-8-findings.md](./round-8-findings.md): Scheme E robustness 検証
- [docs/plans/2026-04-24-round-11-phase2-execution.md](../plans/2026-04-24-round-11-phase2-execution.md): Phase 2 実装計画
- [auto-stock-trader/src/jobs/market-assessment.ts](../../../auto-stock-trader/src/jobs/market-assessment.ts): sibling project の実装
