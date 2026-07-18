# auto-crypto-trader — Claude Code 向け プロジェクト指示

## プロジェクト概要

BTC/ETH の自動取引システム。2つの独立戦略を運用。

### Phase 2: Directional Strategy (Scheme E)
- **戦略**: 2-signal weighted ensemble (DXY 0.60 + Funding 0.40)
- **検証**: Round 7/8 で 10 年 backtest 検証済（OOS Sharpe 1.10）
- **取引所**: GMO Coin（spot、JPY pair）
- **リターンドライバー**: 市場方向（ベータ）

### Phase 3: Funding Rate Arbitrage（⏸️ ON HOLD）
- **戦略**: 現物ロング × perpショート（デルタニュートラル）
- **取引所**: GMO Coin（現物）+ Binance（perp）
- **リターンドライバー**: Funding rate（市場中立、キャリー）
- **保留理由**: データ分析の結果、年率リターン1-2%程度で魅力的でないと判断
- **再開条件**: Funding rate が年率15-20%以上（3日平均 0.0137〜0.0183%/8h）になったら再検討
  - ⚠️ 旧記述の「3日平均 > 0.1%」は年率換算109%相当の誤記。年率ベースを正とする（2026-07-18 訂正）
- **Binance API**: public は疎通確認済。**署名付き API は -2015 で失敗＝実発注可否は未確認**（要 Binance 管理画面確認）

**実行**: GitHub Actions + Railway Postgres + cron-job.org

詳細は [README.md](README.md) を参照。

---

## 現在の Phase

### Phase 2: Directional Strategy (Scheme E)
- ✅ Phase 1.5: Virtual P&L tracking
- ✅ Phase 2.1 Micro: ¥30,000 actual execution（2026-04-26 開始、2026-05-09 判定 PASS）
- ✅ **Phase 2.2 Small: ¥100,000 actual execution（2026-05-12 開始、2026-07-11 判定 PASS = 本運用化）**
- ⏭️ Phase 2.3 Seed (¥1M) は skip — 資金準備上の都合で Phase 2.2 完了 = 本運用化と判断（2026-05-14 決定）
- 🎯 **本運用中**: ¥100,000 規模で継続。BTC+ETH multi-asset 配分。増額は利益積み増しで段階的に検討

### Phase 3.0: Funding Rate Arbitrage（⏸️ ON HOLD）
- ✅ **Setup & Design**（完了）— 分析の結果、**一旦保留**と判断
- ⏸️ **ON HOLD**: 現在の市場環境ではfunding rateが低すぎる（手数料考慮後 年率1-2%）
- 📊 最新実測（2026-07-18 再測定）: BTC 直近7日 年率6.37% / 現在値 8.33% — 再開条件（年率15%）の約 42〜55%
- 📈 改善トレンドあり: BTC funding が正の割合 全期間60% → 直近30日97% → 直近7日100%
- 📋 再検討条件: 3日移動平均が年率15-20%相当（0.0137〜0.0183%/8h）で継続したら再開
- ⚠️ 早期警戒ライン: 3日移動平均 > **0.0091%/8h**（年率10%）に到達したら backtest を先行実行
- 🚧 **ブロッカー**: Binance 署名付き API が -2015 で失敗。perp ショート leg の実行可否が未確認
- 📄 詳細: [docs/specs/phase3-funding-arb-analysis.md](docs/specs/phase3-funding-arb-analysis.md)

### Phase 3.1: Market Neutral / BTC-ETH Pair Trading（⏸️ ON HOLD）
- ✅ **Preliminary Analysis**（完了）— 分析の結果、**一旦保留**と判断
- ⏸️ **ON HOLD**: Backtest で全パラメータ組み合わせが負のリターン（Sharpe -1.72 to -2.12）
- 📋 再検討条件: Phase 2 安定運用後、またはバックテスト実装の見直し完了後
- 📄 詳細: [docs/specs/phase3-market-neutral-analysis.md](docs/specs/phase3-market-neutral-analysis.md)

---

## 詳細ルール（必読）

@docs/claude/architecture.md
@docs/claude/rules.md
@docs/claude/forbidden.md
@docs/claude/commands.md

---

## 関連ドキュメント

### Phase 2 (Directional)
- [docs/specs/round-7-findings.md](docs/specs/round-7-findings.md) — Scheme E 確定
- [docs/specs/round-8-findings.md](docs/specs/round-8-findings.md) — Robustness 検証
- [docs/specs/live-operations.md](docs/specs/live-operations.md) — Phase 1 / 1.5 運用
- [docs/plans/2026-04-24-round-11-phase2-execution.md](docs/plans/2026-04-24-round-11-phase2-execution.md) — Phase 2 実装計画

### Phase 3 (Alternative Strategies)
- [docs/specs/phase3-funding-arb-analysis.md](docs/specs/phase3-funding-arb-analysis.md) — Funding Rate Arbitrage 分析（ON HOLD）
- [docs/specs/phase3-market-neutral-analysis.md](docs/specs/phase3-market-neutral-analysis.md) — BTC-ETH Pair Trading 分析（ON HOLD）

### その他
- [docs/specs/github-actions-deployment.md](docs/specs/github-actions-deployment.md) — Railway + GHA デプロイ
- [docs/specs/coin-coverage.md](docs/specs/coin-coverage.md) — 対応 coin 方針
- [docs/specs/market-evaluation-decision.md](docs/specs/market-evaluation-decision.md) — 市場評価 layer 不要の決定

---

## グローバル設定（参考）

ユーザー global rules（`~/.claude/CLAUDE.md`）:

- 明示指示外の作業はしない（「ついで」「せっかく」NG）
- 破壊的操作は必ず確認
- fish shell 使用
- N+1 問題に注意（バッチ INSERT）
- JST 時刻基準
- PR 本文・commit に Claude Code 情報を含めない
