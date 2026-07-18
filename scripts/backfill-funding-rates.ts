/**
 * Backfill historical funding rates from Binance
 */

import 'dotenv/config';
import { BinancePerpClient } from '../src/data/binance-perp-client.js';
import { loadFundingRates } from '../src/data/binance-funding-loader.js';

async function main() {
  const apiKey = process.env.BINANCE_API_KEY || '';
  const apiSecret = process.env.BINANCE_API_SECRET || '';

  const client = new BinancePerpClient(apiKey, apiSecret);

  console.log('Backfilling funding rates from Binance...\n');

  // Define time range (last 1 year)
  const endTime = Date.now();
  const startTime = endTime - 365 * 24 * 60 * 60 * 1000; // 1 year ago

  await loadFundingRates(client, {
    symbols: ['BTCUSDT', 'ETHUSDT'],
    startTime,
    endTime,
    limit: 1000,
  });

  console.log('\n✓ Backfill complete!');
}

main()
  .catch((error) => {
    console.error('Error backfilling funding rates:', error);
    process.exit(1);
  });
