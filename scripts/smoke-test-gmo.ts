/**
 * GMO Coin API read-only smoke test.
 *
 * Verifies:
 *   1. Public API: getTicker(BTC_JPY) and getTicker(ETH_JPY)
 *   2. Private API: getAccountAssets()  — HMAC auth works
 *   3. Private API: getLatestExecutions() — empty OK for fresh account
 *
 * No write operations (placeOrder / cancelOrder) are invoked. Safe to run
 * any time against a live account — it only reads.
 *
 * Usage:
 *   npx tsx scripts/smoke-test-gmo.ts
 *
 * Required env (in .env):
 *   GMO_API_KEY
 *   GMO_API_SECRET
 */

import { GmoClient, GmoApiError } from "../src/live/gmo-client.js";

const yen = (n: number): string =>
  `¥${n.toLocaleString("ja-JP", { maximumFractionDigits: 0 })}`;

async function main(): Promise<void> {
  const apiKey = process.env.GMO_API_KEY;
  const apiSecret = process.env.GMO_API_SECRET;
  if (!apiKey || !apiSecret) {
    console.error("GMO_API_KEY and GMO_API_SECRET must be set in .env");
    process.exit(1);
  }

  const client = new GmoClient({ apiKey, apiSecret });

  console.log("=== GMO Coin API smoke test ===\n");

  console.log("[1/3] Public: getTicker()");
  const btcTicker = await client.getTicker("BTC_JPY");
  const ethTicker = await client.getTicker("ETH_JPY");
  console.log(
    `  BTC_JPY  bid ${yen(btcTicker.bid)} / ask ${yen(btcTicker.ask)} / last ${yen(btcTicker.last)}`,
  );
  console.log(
    `  ETH_JPY  bid ${yen(ethTicker.bid)} / ask ${yen(ethTicker.ask)} / last ${yen(ethTicker.last)}`,
  );
  console.log();

  console.log("[2/3] Private: getAccountAssets() (HMAC auth)");
  const assets = await client.getAccountAssets();
  const relevant = assets.filter((a) =>
    ["JPY", "BTC", "ETH"].includes(a.symbol),
  );
  if (relevant.length === 0) {
    console.log("  (no JPY/BTC/ETH balance yet)");
  } else {
    for (const a of relevant) {
      const label =
        a.symbol === "JPY"
          ? yen(a.amount)
          : `${a.amount.toFixed(8)} ${a.symbol}`;
      console.log(
        `  ${a.symbol.padEnd(4)} amount=${label} available=${a.symbol === "JPY" ? yen(a.available) : a.available.toFixed(8)}`,
      );
    }
  }
  console.log();

  console.log("[3/3] Private: getLatestExecutions()");
  const execs = await client.getLatestExecutions();
  if (execs.length === 0) {
    console.log("  (no recent executions)");
  } else {
    console.log(`  ${execs.length} recent execution(s):`);
    for (const e of execs.slice(0, 5)) {
      console.log(
        `    ${e.timestamp}  ${e.side} ${e.size} ${e.symbol} @ ${yen(e.price)}  fee=${yen(e.fee)}`,
      );
    }
  }
  console.log();

  console.log("✅ All 3 checks passed. GMO client is working.");
}

main().catch((err) => {
  if (err instanceof GmoApiError) {
    console.error(`\n❌ GMO API error:`);
    console.error(`  HTTP ${err.httpStatus}, GMO status ${err.gmoStatus}`);
    console.error(`  ${err.message}`);
    if (err.messages) {
      for (const m of err.messages) {
        console.error(`    ${m.message_code}: ${m.message_string}`);
      }
    }
  } else {
    console.error(`\n❌ Unexpected error:`, err);
  }
  process.exit(1);
});
