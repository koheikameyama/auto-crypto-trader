/**
 * Test Binance Perpetual API connection
 */

import 'dotenv/config';
import { BinancePerpClient, annualizeFundingRate } from '../src/data/binance-perp-client.js';

async function main() {
  const apiKey = process.env.BINANCE_API_KEY || '';
  const apiSecret = process.env.BINANCE_API_SECRET || '';

  if (!apiKey || !apiSecret) {
    console.warn('⚠️  BINANCE_API_KEY or BINANCE_API_SECRET not set, using public endpoints only');
  }

  const client = new BinancePerpClient(apiKey, apiSecret);

  console.log('Testing Binance Perpetual API connection...\n');

  // 1. Ping
  console.log('1. Testing ping...');
  const pingSuccess = await client.ping();
  console.log(pingSuccess ? '✓ Ping successful' : '✗ Ping failed');

  // 2. Server time
  console.log('\n2. Getting server time...');
  const serverTime = await client.getServerTime();
  console.log(`✓ Server time: ${new Date(serverTime).toISOString()}`);

  // 3. Current mark price and funding rate
  console.log('\n3. Getting mark price and funding rate for BTCUSDT...');
  const markPrice = await client.getMarkPrice('BTCUSDT');
  if (!Array.isArray(markPrice)) {
    console.log(`✓ Mark Price: $${parseFloat(markPrice.markPrice).toLocaleString()}`);
    console.log(`  Index Price: $${parseFloat(markPrice.indexPrice).toLocaleString()}`);
    console.log(`  Funding Rate: ${(parseFloat(markPrice.lastFundingRate) * 100).toFixed(4)}%`);
    console.log(`  Annualized: ${annualizeFundingRate(parseFloat(markPrice.lastFundingRate)).toFixed(2)}%`);
    console.log(`  Next Funding: ${new Date(markPrice.nextFundingTime).toISOString()}`);
  }

  // 4. Historical funding rate (last 10)
  console.log('\n4. Getting historical funding rates for BTCUSDT (last 10)...');
  const fundingHistory = await client.getFundingRateHistory('BTCUSDT', undefined, undefined, 10);
  console.log(`✓ Fetched ${fundingHistory.length} records:`);
  fundingHistory.forEach((rate, index) => {
    const date = new Date(rate.fundingTime).toISOString();
    const ratePercent = (parseFloat(rate.fundingRate) * 100).toFixed(4);
    console.log(`  ${index + 1}. ${date} → ${ratePercent}%`);
  });

  // 5. Current price
  console.log('\n5. Getting current price for BTCUSDT...');
  const price = await client.getPrice('BTCUSDT');
  if (!Array.isArray(price)) {
    console.log(`✓ Current Price: $${parseFloat(price.price).toLocaleString()}`);
  }

  console.log('\n✓ All tests passed!');
}

main()
  .catch((error) => {
    console.error('Error testing Binance connection:', error);
    process.exit(1);
  });
