# auto-crypto-trader — Claude Code 向け プロジェクト指示

## プロジェクト概要

BTC/ETH の日次 rebalance を行う暗号通貨自動取引システム。

- **戦略**: Scheme E — 2-signal weighted ensemble (DXY 0.60 + Funding 0.40)
- **検証**: Round 7/8 で 10 年 backtest 検証済（OOS Sharpe 1.10）
- **取引所**: GMO Coin（spot、JPY pair）
- **実行**: GitHub Actions + Railway Postgres + cron-job.org（外部精密 cron）

詳細は [README.md](README.md) を参照。

---

## 現在の Phase

- ✅ Phase 1.5: Virtual P&L tracking
- ✅ Phase 2.1 Micro: ¥30,000 actual execution（2026-04-26 開始、2026-05-09 判定 PASS）
- 🟢 **Phase 2.2 Small: ¥100,000 actual execution（2026-05-12 開始、〜2026-06-12 目処）**
- ⏭️ Phase 2.3 Seed (¥1M) は skip — 資金準備上の都合で Phase 2.2 完了 = 本運用化と判断（2026-05-14 決定）
- 🎯 Phase 2.2 PASS 後は ¥100,000 規模で本運用継続。増額は利益積み増しで段階的に検討

---

## 詳細ルール（必読）

@docs/claude/architecture.md
@docs/claude/rules.md
@docs/claude/forbidden.md
@docs/claude/commands.md

---

## 関連ドキュメント

- [docs/specs/round-7-findings.md](docs/specs/round-7-findings.md) — Scheme E 確定
- [docs/specs/round-8-findings.md](docs/specs/round-8-findings.md) — Robustness 検証
- [docs/specs/live-operations.md](docs/specs/live-operations.md) — Phase 1 / 1.5 運用
- [docs/specs/github-actions-deployment.md](docs/specs/github-actions-deployment.md) — Railway + GHA デプロイ
- [docs/specs/coin-coverage.md](docs/specs/coin-coverage.md) — 対応 coin 方針
- [docs/specs/market-evaluation-decision.md](docs/specs/market-evaluation-decision.md) — 市場評価 layer 不要の決定
- [docs/plans/2026-04-24-round-11-phase2-execution.md](docs/plans/2026-04-24-round-11-phase2-execution.md) — Phase 2 実装計画

---

## グローバル設定（参考）

ユーザー global rules（`~/.claude/CLAUDE.md`）:

- 明示指示外の作業はしない（「ついで」「せっかく」NG）
- 破壊的操作は必ず確認
- fish shell 使用
- N+1 問題に注意（バッチ INSERT）
- JST 時刻基準
- PR 本文・commit に Claude Code 情報を含めない
