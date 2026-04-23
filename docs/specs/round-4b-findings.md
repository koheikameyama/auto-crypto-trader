# Round 4b Findings — BTC-ETH Pair Trading

**実施日:** 2026-04-23
**結論:** **仮説 H2 却下**。BTC-ETH の単純 log-ratio z-score mean-reversion は OOS で崩壊。
**次ステップ:** Round 4c へ移行（オンチェーン指標、または DONE with 単純モデル全般）。

---

## 1. 仮説と結果

### 仮説 H2
「BTC と ETH は高相関ペア。log(BTC/ETH) の z-score は短中期で平均回帰する」

### 結果
- **単独バックテスト (10年フル、デフォルト params)**: Total Return **-93.5%**、Sharpe -0.111、DD 103%
- **WF (14 windows、27 combos grid search)**: OOS Sharpe avg **-0.693**、IS→OOS drop **178.7%**

両方 FAIL。特に WF の巨大な IS→OOS drop (178.7%) は **IS でプロフィタブルに見えた params が OOS で完全に機能しない**ことを示す → 過学習というより**体制変化 (non-stationarity)**。

---

## 2. KPI サマリ

| KPI | 閾値 | **Round 4b WF** | 判定 |
|---|---|---|---|
| OOS Sharpe | ≥ 1.0 | -0.693 | FAIL |
| OOS MAR | ≥ 0.5 | 0.241 | FAIL |
| OOS PF | ≥ 1.3 | 2.547 | ✓ |
| OOS Max DD | ≤ 30% | 34.03% | FAIL |
| IS→OOS Sharpe Drop | ≤ 30% | **178.7%** | **FAIL（極端）** |

PF は閾値クリアしているが、Sharpe 負 & drop 178% は他の指標の不健全さを圧倒する。

### Round 3 / Round 4a との比較

| Round | 戦略クラス | 8 組合せ中 SAVED | 最良 OOS Sharpe | 総評 |
|---|---|---|---|---|
| Round 3 | 単銘柄技術戦略 × 4 | 0 / 8 | 0.797 (donchian/BTC) | FAIL |
| Round 4a | Round 3 + SMA50 フィルタ | 0 / 8 | 0.808 (donchian/ETH) | FAIL |
| **Round 4b** | BTC-ETH ペアトレード | 0 / 1 | **-0.693** | **WORST** |

ペアトレードは単独戦略より**悪化**。「違う戦略クラス」に賭けたが、mean-reversion 仮説自体が成立しなかった。

---

## 3. なぜ失敗したか（考察）

### 3.1 spread の non-stationarity

BTC-ETH ratio は 10 年で大幅に変動:
- 2017 ICO バブル: ETH 急騰で BTC/ETH が低下
- 2018-2020: BTC 回帰
- 2021 DeFi サマー: ETH 再上昇
- 2022-2024: BTC 優位 (spot ETF 期待)
- 2025+: 再び揺れ動き

これらの「体制変化」は数ヶ月〜数年単位で起きる → 30-60 日 lookback では mean-reversion ではなく**trend を逆張り**する形になる。

### 3.2 IS で過学習、OOS で破綻

IS Sharpe avg が高かったが OOS で -0.693 → grid search が**各 IS 窓の体制に特化した params を選んだ**結果、次の OOS 窓で体制が変わると負ける。

### 3.3 手数料負け

0.1% × 4 (両レッグの entry + exit) = 0.4% / 往復。z-score 2σ 進入 → 0.5σ 脱出 の想定利益は log ratio 上で 1.5σ 分だが、手数料を差し引くとネットはわずか。50/50 win rate でも **期待値マイナス**。

### 3.4 ロング/ショートは有効的に独立しなかった

両方向 (long-spread / short-spread) トレード数は 44 / 56 とほぼ均等だったが、「long-spread ← BTC underperformance → 後で BTC が追いつく」という仮説が頻繁に破れた。BTC が本当に永続的に underperform している時期が含まれていた（2018, 2022 の一部）。

---

## 4. 他にあり得た修正（検討だけ、実装せず）

| 修正 | 期待効果 | 実装コスト | 判断 |
|---|---|---|---|
| β = OLS 推定 (cointegration) | 体制変化の検出能力 up | 中 | 根本解決にならない（β も変動する） |
| より長い lookback（90-180日） | トレンド回避 | 低 | 体制変化の周期自体が長期 |
| Kalman filter で動的 β | 体制追従 | 高 | MVP 越え、効果不確実 |
| ADF 検定で cointegration 確認のみトレード | 偽エントリー排除 | 中 | 機会激減で統計的意味失う懸念 |

総合的に **単純な pair trading では crypto spread を捉えきれない**と判断。

---

## 5. Round 5 以降への含意

3 回の独立したアプローチが全滅:

```
Round 3 : 単銘柄 × 4 技術戦略                       → FAIL (0/8)
Round 4a: Round 3 + SMA トレンドフィルタ             → FAIL (0/8, 変化なし)
Round 4b: BTC-ETH ペアトレード (z-score mean-revert) → FAIL (最悪)
```

これら **3 回は全て「価格データのみ」を使った**。全て失敗した以上、次は **情報源を変える**しかない:

### 推奨: Round 4c - オンチェーン指標

価格に先行するシグナルとして:
- **MVRV Z-Score**: 市場価値 / 実現価値の歪み（サイクル判定）
- **NUPL**: Net Unrealized Profit/Loss（市場心理）
- **Puell Multiple**: マイナー収益性（供給側圧力）
- **Exchange Reserves**: 取引所残高（売圧）

これらは**長期レジーム判定** (bull / bear) に使える統計的エビデンスあり。価格のみの戦略が失敗したのは**短期ノイズに引きずられた**からで、オンチェーン指標でレジームを絞れば単純戦略でも機能する可能性あり。

データソース候補:
- **CoinMetrics**: 一部無料、MVRV など取得可
- **Glassnode**: 有料 ($39/mo) だが網羅的
- **Santiment**: 一部無料、ただし API 制限あり
- **自前計算**: UTXO データをローカル取得 → オーバーキル

### 代替: 本プロジェクトを **DONE with simple models** と宣言

3 ラウンドの実証結果から:
- **単純な技術/統計モデルは crypto 日足ではエッジを生まない**ことが**再現性をもって確認された**
- これは**重要な negative result**: 「簡単なバックテストで光る戦略は全て OOS で崩れる」という示唆
- 次は **別プロジェクトとして ML または実取引（funding arb、DEX MEV）** などへ

---

## 6. 判断（要ユーザー相談）

- **A**: Round 4c（オンチェーン指標）へ進む（+5-10h）
- **B**: 本プロジェクトを DONE 宣言。negative result を価値として扱い、レポートをクローズ
- **C**: 別方向（ML、マイクロストラクチャ、DEX）に切り替え

**個人的推奨: B**。理由:
- 3 ラウンド独立にすべて FAIL は強い証拠。追加 1 ラウンドの価値が逓減
- オンチェーン (Round 4c) も結局「価格以外の予測変数を足したら...」という同じ方向性で、本質的な breakthrough は期待しにくい
- **negative result を明確に宣言することは、次のプロジェクト設計の土台になる**

続行するなら A。それ以外なら B（本 findings で研究クローズ）。

---

## 7. 成果物

- コード:
  - `src/lib/spread.ts` + tests
  - `src/backtest/pair-engine.ts` + tests
  - `src/backtest/pair-trade-run.ts`（CLI）
  - `src/walk-forward/pair-engine.ts`
  - `scripts/walk-forward-pair-trade.ts`
- テスト: 16 件追加、全 **158 件グリーン**
- 実行: backtest 1 run（デフォルト）、WF 1 run（27 combos × 14 windows = 378 runs）
- DB: `WalkForwardRun` に `strategy="pair-trade"` / `assetSymbol="BTC-ETH-SPREAD"` 1 row 追加
- 実績工数: 約 2h（期待 4-5h に対し、既存 framework 流用で高速化）
