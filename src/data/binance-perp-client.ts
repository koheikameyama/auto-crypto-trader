/**
 * Binance Perpetual Futures API Client
 *
 * Docs: https://binance-docs.github.io/apidocs/futures/en/
 */

import crypto from 'crypto';

const BASE_URL = 'https://fapi.binance.com';
const SPOT_BASE_URL = 'https://api.binance.com';

export interface FundingRateData {
  symbol: string;
  fundingRate: string;
  fundingTime: number; // Unix timestamp in ms
  markPrice?: string;
}

export interface MarkPriceData {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  estimatedSettlePrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  time: number;
}

export interface PerpPriceData {
  symbol: string;
  price: string;
  time: number;
}

export interface FuturesBalance {
  asset: string;
  balance: string;
  availableBalance: string;
}

export interface FuturesAccountInfo {
  canTrade: boolean;
  canDeposit: boolean;
  canWithdraw: boolean;
  totalWalletBalance: string;
  availableBalance: string;
}

export interface ApiRestrictions {
  ipRestrict: boolean;
  enableWithdrawals: boolean;
  enableSpotAndMarginTrading: boolean;
  enableFutures: boolean;
  enableReading: boolean;
}

export class BinancePerpClient {
  private apiKey: string;
  private apiSecret: string;

  constructor(apiKey: string, apiSecret: string) {
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
  }

  /**
   * Get historical funding rate
   * @param symbol - e.g., "BTCUSDT"
   * @param startTime - Unix timestamp in ms (optional)
   * @param endTime - Unix timestamp in ms (optional)
   * @param limit - Max 1000 (default 100)
   */
  async getFundingRateHistory(
    symbol: string,
    startTime?: number,
    endTime?: number,
    limit: number = 100
  ): Promise<FundingRateData[]> {
    const params: Record<string, string> = {
      symbol,
      limit: limit.toString(),
    };
    if (startTime) params.startTime = startTime.toString();
    if (endTime) params.endTime = endTime.toString();

    const response = await this.publicRequest('/fapi/v1/fundingRate', params);
    return response as FundingRateData[];
  }

  /**
   * Get current mark price and funding rate
   * @param symbol - e.g., "BTCUSDT" (optional, if not provided returns all symbols)
   */
  async getMarkPrice(symbol?: string): Promise<MarkPriceData | MarkPriceData[]> {
    const params: Record<string, string> = {};
    if (symbol) params.symbol = symbol;

    const response = await this.publicRequest('/fapi/v1/premiumIndex', params);
    return response as MarkPriceData | MarkPriceData[];
  }

  /**
   * Get current price
   * @param symbol - e.g., "BTCUSDT" (optional, if not provided returns all symbols)
   */
  async getPrice(symbol?: string): Promise<PerpPriceData | PerpPriceData[]> {
    const params: Record<string, string> = {};
    if (symbol) params.symbol = symbol;

    const response = await this.publicRequest('/fapi/v1/ticker/price', params);
    return response as PerpPriceData | PerpPriceData[];
  }

  /**
   * Get futures wallet balances (signed, read-only)
   */
  async getFuturesBalance(): Promise<FuturesBalance[]> {
    return (await this.signedRequest('/fapi/v2/balance')) as FuturesBalance[];
  }

  /**
   * Get futures account info (signed, read-only)
   * `canTrade` indicates whether this key may place orders — the closest
   * read-only proxy for "can we actually short perp from here?", since the
   * futures API has no test-order endpoint.
   */
  async getFuturesAccountInfo(): Promise<FuturesAccountInfo> {
    return (await this.signedRequest('/fapi/v2/account')) as FuturesAccountInfo;
  }

  /**
   * Get API key permissions (signed, read-only)
   * Lives on the spot base URL, not fapi.
   */
  async getApiRestrictions(): Promise<ApiRestrictions> {
    return (await this.signedRequest(
      '/sapi/v1/account/apiRestrictions',
      {},
      'GET',
      SPOT_BASE_URL
    )) as ApiRestrictions;
  }

  /**
   * Public request (no authentication)
   */
  private async publicRequest(
    endpoint: string,
    params: Record<string, string> = {}
  ): Promise<any> {
    const queryString = new URLSearchParams(params).toString();
    const url = `${BASE_URL}${endpoint}${queryString ? `?${queryString}` : ''}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Binance API error: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  /**
   * Signed request (with authentication)
   * Used for trading endpoints (Phase 2)
   */
  private async signedRequest(
    endpoint: string,
    params: Record<string, string> = {},
    method: 'GET' | 'POST' | 'DELETE' = 'GET',
    baseUrl: string = BASE_URL
  ): Promise<any> {
    const timestamp = Date.now();
    const paramsWithTimestamp = {
      ...params,
      timestamp: timestamp.toString(),
    };

    const queryString = new URLSearchParams(paramsWithTimestamp).toString();
    const signature = crypto
      .createHmac('sha256', this.apiSecret)
      .update(queryString)
      .digest('hex');

    const url = `${baseUrl}${endpoint}?${queryString}&signature=${signature}`;

    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-MBX-APIKEY': this.apiKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Binance API error: ${response.status} ${errorText}`);
    }

    return response.json();
  }

  /**
   * Test connectivity (public endpoint)
   */
  async ping(): Promise<boolean> {
    try {
      await this.publicRequest('/fapi/v1/ping');
      return true;
    } catch (error) {
      console.error('Binance ping failed:', error);
      return false;
    }
  }

  /**
   * Get server time
   */
  async getServerTime(): Promise<number> {
    const response = await this.publicRequest('/fapi/v1/time');
    return response.serverTime;
  }
}

/**
 * Utility: Convert funding rate to annualized percentage
 * @param fundingRate - e.g., 0.0001 (0.01%)
 * @returns Annualized rate in percentage (e.g., 10.95%)
 */
export function annualizeFundingRate(fundingRate: number): number {
  // Funding occurs every 8 hours, so 3 times per day
  return fundingRate * 3 * 365 * 100;
}

/**
 * Utility: Check if funding rate meets entry threshold
 * @param fundingRate - Current funding rate
 * @param threshold - Entry threshold (e.g., 0.0001 for 0.01%)
 * @returns True if meets threshold
 */
export function meetsEntryThreshold(fundingRate: number, threshold: number): boolean {
  return fundingRate > threshold;
}
