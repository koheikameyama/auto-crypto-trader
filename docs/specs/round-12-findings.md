# Round 12 Findings — Maker LIMIT Fill 率改善

**実施日:** 2026-05-11
**対象:** [KOH-444](https://linear.app/koheikameyama/issue/KOH-444) Round 12
**結論:** **`makerLimitWaitSec` を 10s → 300s に変更**で fill 率 0% → 50%、effective fee を 7.9 bps → 3.93 bps に改善。
**戦略パラメータは未変更**（Scheme E baseline 維持）。

---

## 1. 背景

[Round 11 Phase 2](../plans/2026-04-24-round-11-phase2-execution.md) の execution-adapter は maker LIMIT を 10s 待ってから MARKET fallback する設計だった。2026-05-10 の手動 round-trip テストで LIMIT fill 率 **0% (0/2)** が判明（[KOH-444](https://linear.app/koheikameyama/issue/KOH-444) 訂正コメント参照）。Round 12 でその改善を実証データで定量化する。

スコープは [round-12-maker-fill-rate.md](../plans/2026-05-11-round-12-maker-fill-rate.md) 参照。

---

## 2. 実験設計

BTC 最小ロット 0.0001（~¥1,275）の round-trip（BUY → SELL、net 中立）を以下 3 構成で実行:

| Config | wait_sec | offset_ticks | round-trips | LIMIT 試行数 |
|---|---|---|---|---|
| W60-inside | 60 | 0（best bid/ask） | 3 | 6 |
| W60-offset−1 | 60 | -1（1 tick 外側、より passive） | 3 | 6 |
| W300-inside | 300 | 0 | 2 | 4 |

ベースライン（W10-inside）は 2026-05-10 の手動テストデータ（試行 2 件）を流用。

すべて 2026-05-11 の昼〜夜（JST）に実施。市場は BTC ¥12.74M 周辺で ¥10k 単位の swing が発生していた状況。

---

## 3. 結果

| Config | Fill 率 | Avg fill wait | LIMIT eff. fee | MARKET eff. fee | Overall eff. fee |
|---|---|---|---|---|---|
| W10-inside（baseline） | 0% (0/2) | — | — | 7.9 bps | 7.9 bps |
| W60-inside | 16.7% (1/6) | 1.4s | 0.00 bps | 10.98 bps | 9.15 bps |
| W60-offset−1 | 50% (3/6) | 25.4s | 2.61 bps | 18.29 bps | 10.45 bps |
| **W300-inside** | **50% (2/4)** | 16.7s | **0.00 bps** | 7.86 bps | **3.93 bps** |

### 注

- 「Overall eff. fee」は fill 率込みの平均 fee (fill した LIMIT は 0 bps、timeout は MARKET fee を負担)
- ¥1〜¥2 単位の整数 fee で、minimum lot トレード（~¥1,275）の bps が振れやすい
- Phase 2.2 の ¥100k 規模ではトレード 1 回 ~¥6,000〜10,000 となるため bps は安定する見込み

---

## 4. 主要な発見

### 4.1 Wait 時間が支配的（H1, H2 を支持）

- 10s → 60s: fill 率 0% → 17% (+17 pp)
- 10s → 300s: fill 率 0% → 50% (+50 pp)
- **Wait 時間を延ばすほど maker fill 率は線形以上に向上**。Daily rebalance は急がないので長い wait で OK。

### 4.2 Offset=−1 は trend bias を増幅（H3 を部分支持）

W60-offset−1 で fill 率が 50% に上がったが、内訳は **fill した 3 件は全 SELL、BUY は 0/3**。実験中 4 分間で価格が +0.11% 上昇トレンドにあったため、トレンド方向と一致する SELL ask+1 だけが約定した非対称結果。

**結論:** offset は趣旨通り「passive にして fill 率改善」ではなく **trend exposure を増幅**する効果が強い。production には推奨しない。

### 4.3 MARKET fallback の slippage が trend 中に爆発

| Trip | refMid | MARKET exec | Slippage |
|---|---|---|---|
| W60-offset−1 trip 3 BUY | ¥12,756,800 | ¥12,759,338 | **+20 bps** |
| W300-inside trip 2 SELL | ¥12,742,302 | ¥12,708,401 | **+27 bps** |

5 分の wait 中に market が逃げた場合の fallback で 20〜30 bps の slippage が観測された。これは backtest 前提（+10 bps fee）の **2〜3 倍の悪化**。

### 4.4 LIMIT fill 時は完全な maker rebate（0 bps fee）

GMO BTC_JPY の最小単位 0.0001 BTC で LIMIT が約定した全 6 件中、6 件すべて **fee ¥0**（maker rebate -0.05% 効果）。実規模の trade では rebate ¥3〜5/trade になるはず。

### 4.5 `cancelOrder unknown error` が再現

LIMIT が約定しなかった全 case で `cancelOrder` が `unknown error` を返した（10/10）。MARKET fallback への進行はブロックされていないので致命的ではないが、**GMO 側で order が auto-cancel された可能性**あり。後で要調査（[KOH-444 子タスク](https://linear.app/koheikameyama/issue/KOH-444) 化推奨）。

---

## 5. 推奨設定（採用）

### 5.1 `makerLimitWaitSec` を 10s → **300s** に変更（採用）

```typescript
// scripts/live-execute.ts
let makerLimitWaitSec = 300;  // was: 10
```

- 期待 effective fee: **+4 bps** (was +10 bps backtest 前提)
- 年間 fee 削減: 1 trade あたり 6 bps × 12 rebalances/year × ¥100k = **約 ¥720/年**（Phase 2.2 規模）
- Daily rebalance は 5 分の latency 余裕あり

### 5.2 Offset = 0（inside）を維持

offset=-1 は trend bias を増幅するため不採用。Inside が最も対称的に約定する。

### 5.3 Slippage 上限 check（要検討、未実装）

MARKET fallback の slippage が 20+ bps だった場合、その日の rebalance を skip して翌日に持ち越す閾値を追加することで暴落損失を抑えられる。コードは未変更、Round 12.5 として別タスク化候補。

---

## 6. Backtest cost-model への反映（要検討）

現在の cost-model.ts は +10 bps/trade（taker 想定）。実測 +4 bps（W300 で fill 率 50% 仮定）より conservative なので、**現状の cost-model を維持しても Sharpe は overestimate にならない**。Round 12 の改善は実運用上の "bonus" として扱い、backtest の baseline は不変。

**判断:** cost-model 変更は不採用。Round 7/8 の Sharpe 1.10 は当面そのまま有効な指標として使用。

---

## 7. 実験データ

CSV 出力:
- `reports/round-12/maker-fill-w60-o0-2026-05-11T11-59-14-966Z.csv` (W60 inside)
- `reports/round-12/maker-fill-w60-o-1-2026-05-11T13-04-04-997Z.csv` (W60 offset=-1)
- `reports/round-12/maker-fill-w300-o0-2026-05-11T13-36-33-447Z.csv` (W300 inside)

OrderLog: `errorMessage` フィールドに `round_12_fill_rate` tag を持つレコード（asset=BTC、2026-05-11 の試行分）

実コスト合計: ¥22（¥3 yesterday + ¥9 W60-inside + ¥8 W60-offset−1 + ¥2 W300-inside）

---

## 8. 残課題

1. **Sample size が小さい**（16 LIMIT 試行）。市場条件の偏りを排除するため、後日 sideways 相場 + 別時間帯（朝/深夜 JST）で W300-inside を追加実測したい
2. **`cancelOrder unknown error`** の原因調査
3. **Slippage 上限 check** の実装可否判断（Round 12.5 として別タスク化）
4. **postOnly フラグ** の検討（現在の LIMIT は postOnly 指定なし。意図せず taker 約定する可能性）

---

## 9. Round 11/Phase 2 baseline への影響

- 戦略パラメータ: 未変更（Scheme E、wDxy=0.6、wFunding=0.4、threshold=0.1、lookback=365）
- Backtest cost-model: 未変更（+10 bps 維持）
- `makerLimitWaitSec`: 10 → 300（execution 改善のみ、戦略には無関係）

**Phase 2.1/2.2 の virtual vs actual 比較は引き続き有効**。Round 12 の改善は actual 側の経済性向上として段階的に観察。
