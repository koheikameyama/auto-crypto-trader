/**
 * Binance Futures API read-only smoke test.
 *
 * Purpose: verify that the perp-short leg of Phase 3 funding arb is actually
 * executable from this environment BEFORE funding rates reach the entry
 * threshold — so we don't discover an access problem at go-time.
 *
 * Verifies:
 *   1. Public API: ping + server time skew
 *   2. Public API: premiumIndex(BTCUSDT/ETHUSDT) — current funding rate
 *   3. Private API: getFuturesBalance()     — HMAC auth works
 *   4. Private API: getFuturesAccountInfo() — canTrade flag
 *   5. Private API: getApiRestrictions()    — key permission bits
 *
 * No write operations are invoked. The futures API has no test-order
 * endpoint, so `canTrade` + `enableFutures` are the strongest read-only
 * evidence available that orders would be accepted.
 *
 * Usage:
 *   set -a && . ./.env && set +a
 *   npx tsx scripts/smoke-test-binance.ts
 *
 * Required env (in .env):
 *   BINANCE_API_KEY
 *   BINANCE_API_SECRET_KEY
 */

import {
  BinancePerpClient,
  annualizeFundingRate,
  type MarkPriceData,
} from "../src/data/binance-perp-client.js";

const SYMBOLS = ["BTCUSDT", "ETHUSDT"];

const flag = (b: boolean): string => (b ? "✅ true" : "❌ false");

async function main(): Promise<void> {
  const apiKey = process.env.BINANCE_API_KEY;
  const apiSecret = process.env.BINANCE_API_SECRET_KEY;
  if (!apiKey || !apiSecret) {
    console.error(
      "BINANCE_API_KEY and BINANCE_API_SECRET_KEY must be set in .env",
    );
    process.exit(1);
  }

  const client = new BinancePerpClient(apiKey, apiSecret);

  console.log("=== Binance Futures API smoke test ===\n");

  console.log("[1/5] Public: ping() + getServerTime()");
  const alive = await client.ping();
  if (!alive) throw new Error("ping failed");
  const serverTime = await client.getServerTime();
  const skewMs = serverTime - Date.now();
  console.log(`  ping OK`);
  console.log(`  server time skew: ${skewMs} ms`);
  if (Math.abs(skewMs) > 1000) {
    console.log(
      `  ⚠️  skew > 1000ms — signed requests may fail with -1021 (recvWindow)`,
    );
  }
  console.log();

  console.log("[2/5] Public: getMarkPrice() — current funding rate");
  for (const symbol of SYMBOLS) {
    const mark = (await client.getMarkPrice(symbol)) as MarkPriceData;
    const rate = parseFloat(mark.lastFundingRate);
    const next = new Date(mark.nextFundingTime).toISOString();
    console.log(
      `  ${symbol.padEnd(8)} mark=${parseFloat(mark.markPrice).toFixed(2)}  ` +
        `funding=${(rate * 100).toFixed(5)}%/8h (年率 ${annualizeFundingRate(rate).toFixed(2)}%)  next=${next}`,
    );
  }
  console.log();

  console.log("[3/5] Private: getFuturesBalance() (HMAC auth)");
  const balances = await client.getFuturesBalance();
  const funded = balances.filter((b) => parseFloat(b.balance) !== 0);
  if (funded.length === 0) {
    console.log("  (no non-zero futures balance — auth still succeeded)");
  } else {
    for (const b of funded) {
      console.log(
        `  ${b.asset.padEnd(6)} balance=${b.balance} available=${b.availableBalance}`,
      );
    }
  }
  console.log();

  console.log("[4/5] Private: getFuturesAccountInfo()");
  const account = await client.getFuturesAccountInfo();
  console.log(`  canTrade:            ${flag(account.canTrade)}`);
  console.log(`  canDeposit:          ${flag(account.canDeposit)}`);
  console.log(`  canWithdraw:         ${flag(account.canWithdraw)}`);
  console.log(`  totalWalletBalance:  ${account.totalWalletBalance}`);
  console.log(`  availableBalance:    ${account.availableBalance}`);
  console.log();

  console.log("[5/5] Private: getApiRestrictions()");
  let futuresEnabled: boolean | null = null;
  try {
    const r = await client.getApiRestrictions();
    futuresEnabled = r.enableFutures;
    console.log(`  enableReading:               ${flag(r.enableReading)}`);
    console.log(`  enableFutures:               ${flag(r.enableFutures)}`);
    console.log(
      `  enableSpotAndMarginTrading:  ${flag(r.enableSpotAndMarginTrading)}`,
    );
    console.log(`  enableWithdrawals:           ${flag(r.enableWithdrawals)}`);
    console.log(`  ipRestrict:                  ${flag(r.ipRestrict)}`);
    if (r.enableWithdrawals) {
      console.log(
        `  ⚠️  出金権限が ON。GMO と同様、取引権限のみに絞ることを推奨`,
      );
    }
    if (!r.ipRestrict) {
      console.log(
        `  ℹ️  IP 制限なし。GitHub Actions から使う場合は IP 固定が難しいので現状で可`,
      );
    }
  } catch (err) {
    // sapi lives on the spot API — a futures-only key may not reach it.
    console.log(
      `  ⚠️  取得失敗（futures 専用 key では届かないことがある）: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  console.log();

  const canShortPerp = account.canTrade && futuresEnabled !== false;
  if (canShortPerp) {
    console.log(
      "✅ 全チェック通過。perp ショート leg は実行可能な状態（canTrade=true）。",
    );
  } else {
    console.log(
      "❌ perp ショートは現状実行不可。canTrade / enableFutures を確認してください。",
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(`\n❌ Binance API error:`, err instanceof Error ? err.message : err);
  console.error(
    `\nヒント: -2015 は key 無効/権限不足/IP 制限、-1021 は時刻ズレ、` +
      `HTTP 451 は地域制限（日本からの futures 利用可否）を示唆します。`,
  );
  process.exit(1);
});
