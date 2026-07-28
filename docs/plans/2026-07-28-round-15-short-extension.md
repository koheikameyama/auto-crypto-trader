# Round 15 計画 — Scheme E ショート拡張（sizing -1〜1）

**作成日:** 2026-07-28
**Linear:** [KOH-591](https://linear.app/koheikameyama/issue/KOH-591)
**ステータス:** 計画のみ（実装・backtest 実行は未着手）
**スコープ:** backtest 検証のみ。**live 統合は本 Round の対象外。**

---

## 1. 背景 — long-only の構造的限界

Scheme E は signal score を [0, 1] に写像し、その加重平均をそのまま
target position とする（[signal-computer.ts:104-107](../../src/live/signal-computer.ts#L104-L107)）。
したがって **position は常に 0〜1、ショートは取れない**。

ライブ実績がこの限界を両側から示した:

| 局面 | 期間 | 戦略 | BH (JPY) | 差 |
|---|---|---|---|---|
| 下落 | 2026-05-20 〜 07-28 | **-3.0%** | -15.0% | **+12pp** ✅ |
| 上昇 | 2026-07 単月 | **+2.98%** | +9.18% | **-6.19pp** ❌ |

- 下落局面: 現金比率を上げて**負けにくくはなった**が、**絶対リターンは負**。
  同じ signal でショートしていれば、この局面はプラスになりえた。
- 上昇局面: 捕捉率 32%。これは長期保有に劣後する側面だが、
  risk-adjusted return を狙う設計上は許容範囲。

つまり **signal の方向性判断そのものは機能している**（下落を事前に検知して
ポジションを落とせた）のに、**その判断を片側にしか使えていない**。
ショート側を開放すれば、同じ signal から追加のリターン源が取れる可能性がある。

---

## 2. 仮説

**H1:** score を [-1, 1] に写像すると、下落局面で正のリターンが出る分だけ
OOS Sharpe が改善する。

**H2:** ただし取引回数と平均 exposure が増えるため、fee / funding コストが
Sharpe 改善を食う可能性がある。特に perp ショートは funding の符号次第で
コストにもリターンにもなる。

**H2 の補足（重要な相互作用）:** Scheme E の funding signal は
「funding percentile が高い → score 低 → ポジション減」という向き。
ショート拡張すると「funding が高いときにショート」= **perp ショートで funding を
受け取る**方向になり、signal とキャリーが同符号で噛み合う。逆に funding が
負の局面でショートすると funding を払う。この符号関係を cost model に
正しく織り込まないと backtest が楽観側に歪む。

---

## 3. 検証する sizing 案

現行: `target = Σ(w_i · s_i) / Σw_i`、`s_i ∈ [0, 1]` → `target ∈ [0, 1]`

| 案 | 写像 | 意図 |
|---|---|---|
| **V0**（baseline） | `target = s` | 現行。比較基準 |
| **V1** 線形 | `target = 2s - 1` | 最も素直な拡張。s=0.5 で flat |
| **V2** デッドバンド | `\|s - 0.5\| < d` なら 0、それ以外は V1 を [-1,1] に再スケール。`d ∈ {0.05, 0.10, 0.15}` | 中立域での無駄な往復を抑え、fee を削る |
| **V3** 非対称 | long は `[0, 1]`、short は `[-k, 0]`、`k ∈ {0.3, 0.5}` | 暗号通貨の右裾（暴騰）リスクを踏まえ、ショート側の上限を絞る |

**core weight (wDxy=0.60, wFunding=0.40) は固定。**
in-sample で選ぶのは `dxySmaPeriod` / `rebalanceThreshold` / 各案の追加パラメータ
（`d`, `k`）のみ。これは Round 14 と同じ方針で、weight 再最適化による
過学習を避けるため。

---

## 4. 検証設計

### 4.1 Walk-forward 構成（Round 7/8/14 と同一）

| 項目 | 値 |
|---|---|
| IS | 365 日 |
| OOS | 182 日 |
| Step | 182 日 |
| 資産 | BTC-USD, ETH-USD |
| 期間 | 10 年（BTC）/ 利用可能全期間（ETH） |

Round 7/8 と同じ window 構成を使うことで、**V0 の再現値が既知の
OOS Sharpe（BTC 1.099 / ETH 1.026）と一致するか**を先にチェックできる。
一致しなければ実装バグとして扱い、V1〜V3 の評価に進まない。

### 4.2 コストモデル

ショートは spot では表現できないため、backtest は **perp 建て**を仮定する:

| コスト要素 | 扱い |
|---|---|
| 取引手数料 | Round 12 実測を流用（maker -5bps / taker +7.9bps）。ただし perp の実 fee 体系は GMO spot と異なるため、**保守側に taker 一律で置く感度分析も実施** |
| Funding | ロング時は支払い、ショート時は受取（funding が正の場合）。`FundingRateDetail` の実データを日次で積算 |
| 借入 / 証拠金コスト | perp は funding に内包されるため二重計上しない |
| 清算 | レバレッジ 1x 以下（`\|target\| ≤ 1`）を前提とし、清算はモデル化しない |

### 4.3 判定基準

| 基準 | 閾値 |
|---|---|
| **Strict** | OOS Sharpe ≥ **1.20**（V0 の BTC 1.099 を +0.10 以上上回る）かつ Max DD ≤ V0 かつ IS→OOS drop ≤ 30% かつ BTC/ETH 両方で成立 |
| **Weak** | OOS Sharpe ≥ V0 + 0.05 かつ Max DD ≤ V0 × 1.1 かつ drop ≤ 30% |
| **不採用** | 上記いずれも満たさない、または片方の資産のみで成立 |

**Sharpe が同等なら不採用。** ショートは実行面のリスク（清算、取引所依存、
規制）が増えるため、「同じくらい良い」では採用理由にならない。

---

## 5. 実行面のブロッカー（backtest が PASS しても即 live にはならない）

| # | ブロッカー | 状況 |
|---|---|---|
| B1 | GMO **spot** ではショート不可 | 確定。GMO レバレッジ取引口座 or 海外 perp が必要 |
| B2 | Binance 署名付き API が **-2015** で失敗 | 未解決。Phase 3 と同じブロッカー（[CLAUDE.md](../../CLAUDE.md) 参照） |
| B3 | 日本からの perp 取引の可否 | 要確認。GMO コイン レバレッジ取引（国内、最大 2x）が現実的な候補 |
| B4 | 現行の execution-adapter は `position ∈ [0,1]` 前提 | ショート対応は adapter の実質的な作り直し。Phase 2 baseline に影響するため別 Round 必須 |

**したがって本 Round のゴールは「ショート拡張に統計的な価値があるか」の
判定までとする。** 価値があると分かって初めて B1〜B4 の解決コストを
払う価値が議論できる。

---

## 6. 進め方

| Phase | 内容 | 見積 |
|---|---|---|
| A | `weighted-ensemble-engine` に sizing map を差し込めるようにする（V0 で既知値を再現するところまで） | 3 時間 |
| B | V1 / V2 / V3 の実装 + funding 符号を含む cost model | 3 時間 |
| C | BTC/ETH 10y walk-forward 実行 | 半日（実行時間） |
| D | 感度分析（fee 保守ケース、`d` / `k` グリッド） | 2 時間 |
| E | findings doc + 採否判断 | 1 時間 |
| **合計** | | **~9 時間 + 半日** |

**Phase A で V0 の既知値が再現できなければ、そこで中断する。**

---

## 7. スコープ外

- live execution への統合（B4 のとおり別 Round）
- core weight (wDxy / wFunding) の再最適化
- 新 signal の追加
- SOL/BNB など BTC/ETH 以外への展開（Round 14 で FAIL 済）
- レバレッジ 1x 超

---

## 8. リスク

| リスク | 影響 | Mitigation |
|---|---|---|
| ショートの右裾リスクが backtest で過小評価される | 実運用で想定外の DD | Max DD を必須ゲートに入れる。V3（非対称）を必ず候補に含める |
| Funding の符号を取り違える | backtest が楽観側に歪む | Phase A で単体テストを書き、既知の期間で手計算と突き合わせる |
| 「ついで」に weight も最適化したくなる | [forbidden.md #1 / #7](../claude/forbidden.md) 抵触、Phase 2 baseline 崩壊 | core weight 固定を本計画の前提として明記済 |
| backtest PASS しても実行できず塩漬け | 工数の無駄 | B1〜B3 の確認を Phase A と**並行**で進める（B3 が NG なら Round 自体を中止） |

---

## 9. 関連

- [round-7-findings.md](../specs/round-7-findings.md) — Scheme E 確定（BTC OOS Sharpe 1.099）
- [round-8-findings.md](../specs/round-8-findings.md) — Robustness / ETH cross-asset（1.026）
- [round-14-findings.md](../specs/round-14-findings.md) — SOL/BNB FAIL、edge の境界
- [2026-07-28-phase2-scale-up-criteria.md](2026-07-28-phase2-scale-up-criteria.md) — 増額判断（本 Round とは独立）
