/**
 * Binance Funding Rate Loader
 *
 * Loads historical funding rate data from Binance and stores in DB
 */

import { PrismaClient } from '@prisma/client';
import { BinancePerpClient, FundingRateData } from './binance-perp-client.js';

const prisma = new PrismaClient();

export interface FundingRateLoadOptions {
  symbols: string[]; // e.g., ["BTCUSDT", "ETHUSDT"]
  startTime?: number; // Unix timestamp in ms
  endTime?: number; // Unix timestamp in ms
  limit?: number; // Max records per request (default 1000)
}

export async function loadFundingRates(
  client: BinancePerpClient,
  options: FundingRateLoadOptions
): Promise<void> {
  const { symbols, startTime, endTime, limit = 1000 } = options;

  for (const symbol of symbols) {
    console.log(`Loading funding rates for ${symbol}...`);

    // Fetch funding rate history
    const fundingRates = await client.getFundingRateHistory(
      symbol,
      startTime,
      endTime,
      limit
    );

    console.log(`Fetched ${fundingRates.length} funding rate records for ${symbol}`);

    // Upsert to DB
    for (const rate of fundingRates) {
      await prisma.fundingRateDetail.upsert({
        where: {
          symbol_timestamp: {
            symbol,
            timestamp: new Date(rate.fundingTime),
          },
        },
        create: {
          symbol,
          timestamp: new Date(rate.fundingTime),
          rate: parseFloat(rate.fundingRate),
          markPrice: rate.markPrice ? parseFloat(rate.markPrice) : null,
        },
        update: {
          rate: parseFloat(rate.fundingRate),
          markPrice: rate.markPrice ? parseFloat(rate.markPrice) : null,
        },
      });
    }

    console.log(`Stored ${fundingRates.length} funding rates for ${symbol}`);
  }
}

/**
 * Load latest funding rate (for daily execution)
 */
export async function loadLatestFundingRate(
  client: BinancePerpClient,
  symbol: string
): Promise<FundingRateData | null> {
  const fundingRates = await client.getFundingRateHistory(symbol, undefined, undefined, 1);
  return fundingRates.length > 0 ? fundingRates[0] : null;
}

/**
 * Calculate average funding rate over N periods
 */
export async function getAverageFundingRate(
  symbol: string,
  periods: number = 9 // 3 days (3 periods per day)
): Promise<number> {
  const rates = await prisma.fundingRateDetail.findMany({
    where: { symbol },
    orderBy: { timestamp: 'desc' },
    take: periods,
  });

  if (rates.length === 0) return 0;

  const sum = rates.reduce((acc, rate) => acc + rate.rate, 0);
  return sum / rates.length;
}
