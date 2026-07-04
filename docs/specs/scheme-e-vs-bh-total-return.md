# Scheme E vs Buy & Hold — 総リターン & 公平 Sharpe 比較

**実施日:** 2026-06-05
**目的:** WF report の "Beats BH" が **Sharpe ベースのみ**で総リターンを記録していなかったため、
総リターンでも比較。さらに「窓平均 Sharpe vs full-period Sharpe」の apples-to-oranges 疑いを
**固定パラメータ・同一方法**で検証する。
**スクリプト:**
- [scripts/compare-scheme-e-vs-bh.ts](../../scripts/compare-scheme-e-vs-bh.ts) — full-period 単一比較
- [scripts/wf-scheme-e-fixed-vs-bh.ts](../../scripts/wf-scheme-e-fixed-vs-bh.ts) — 固定パラメータ WF・公平 Sharpe

> ⚠️ **修正履歴:** 初版は macro ticker を誤って `DXY`（DB には存在せず空）で読み込み、
> **DXY シグナルが score 0.5 固定＝実質 funding 単独**で走っていた。正しくは `DX-Y.NYB`。
> 修正前の「Scheme E は BH に Sharpe でも負ける」は誤りで、本版が正しい結果。

---

## 測定条件

- パラメータは **live 運用 (signal-computer) と同一に固定**:
  `wDxy=0.60, wFunding=0.40, dxySmaPeriod=200, fundingLookback=365, rebalanceThreshold=0.10`
- macro ticker: DXY=`DX-Y.NYB`, funding=`BTCUSDT`/`ETHUSDT`
- 手数料込み（engine の `applyFee`）
- WF: IS 365d / OOS 182d / step 182d、**窓ごとハイパラ再最適化なし（固定）**
- BH も同じ OOS 窓で Sharpe を測定 → 窓平均で公平比較

---

## 結果① full-period（live と同じ固定パラメータ）

| 指標 | BTC Scheme E | BTC BH | ETH Scheme E | ETH BH |
|---|---|---|---|---|
| 総リターン | 625% (7.25×) | 664% (7.64×) | **1127% (12.3×)** | 861% (9.61×) |
| Sharpe | **1.079** | 0.811 | **1.053** | 0.835 |
| Max DD | **33.5%** | 76.6% | **46.5%** | 79.4% |
| MAR | **1.03** | 0.46 | **0.99** | 0.52 |
| rebalance 回数 | 473 | — | 456 | — |

- **BTC: 生リターンは BH の 95%（ほぼ同等）で、DD は半分以下（76.6%→33.5%）**
- **ETH: 生リターンで BH を 28% 上回り、DD も大幅減**
- MAR が約 2 倍（0.46→1.03）= リスク調整後で明確に優位

## 結果② 固定パラメータ WF（同一方法・公平 Sharpe）

| | BTC Scheme E | BTC BH | ETH Scheme E | ETH BH |
|---|---|---|---|---|
| **Sharpe（窓平均 OOS）** | **1.173** | 0.862 | **0.879** | 0.656 |
| Sharpe（全期間） | 1.079 | 0.811 | 1.053 | 0.835 |
| 窓ごと勝率 | **8/11** | — | **8/11** | — |

- **窓平均でも全期間でも、固定パラメータで BH を上回る** → apples-to-oranges 疑いは解消。
  Scheme E の Sharpe 優位は測定方法に依存しない**本物**。
- 窓ごとハイパラ再最適化（元 WF）に頼らずとも edge が出る。

---

## 結論（再定義）

**Scheme E は「BTC とほぼ同等〜上回るリターンを、半分の DD で得る」戦略。**

- 当初疑った「上昇相場で上値の 6 割を放棄」は **DXY バグによる誤計測**で、実際は放棄ほぼなし
  （BTC 95%、ETH は逆に超過）。
- DXY（マクロ・最強シグナル）が 2022 弱気相場などで的確に de-risk し、DD を 76%→33% に圧縮。
- これがリターンをほぼ保ちつつ DD を半減できる理由。
- WF report の 1.096 / DD 50% は「窓ごと再最適化＋窓 max DD」基準。固定パラメータの方が DD が
  むしろ良い（33.5%）のは、固定 200d SMA の安定性による。

→ **戦略の正当性は確認。** Phase 2.2 実運用の前提は妥当。

---

## 教訓

- backtest 系スクリプトを新規に書く際は **macro ticker 名（`DX-Y.NYB`, `^VIX`, `^TNX`）を
  既存 WF と必ず突合**する。空配列でも engine は score 0.5 で黙って走るため、
  シグナル欠落に気づきにくい（sanity log を入れるべき）。
