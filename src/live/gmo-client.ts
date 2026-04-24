import * as crypto from "node:crypto";

/**
 * Minimal GMO Coin API client.
 *
 * Docs: https://api.coin.z.com/docs/
 *   - Public:  https://api.coin.z.com/public
 *   - Private: https://api.coin.z.com/private  (HMAC-SHA256 auth)
 *
 * Scope (Phase 2 Scheme E execution):
 *   - getTicker(symbol)          — public, latest bid/ask/last
 *   - getAccountAssets()         — private, balances (JPY / BTC / ETH)
 *   - placeOrder(params)         — private, spot limit/market order
 *   - cancelOrder(orderId)       — private, cancel a single order
 *   - getActiveOrders(symbol?)   — private, open orders
 *   - getLatestExecutions(symbol?) — private, recent fills
 */

const PUBLIC_BASE_URL = "https://api.coin.z.com/public";
const PRIVATE_BASE_URL = "https://api.coin.z.com/private";

export type GmoSymbol = "BTC" | "ETH" | "BTC_JPY" | "ETH_JPY";

export interface GmoClientConfig {
  apiKey: string;
  apiSecret: string;
  fetchImpl?: typeof fetch;
}

export interface Ticker {
  symbol: string;
  ask: number;
  bid: number;
  last: number;
  high: number;
  low: number;
  volume: number;
  timestamp: string;
}

export interface AccountAsset {
  symbol: string;
  amount: number;
  available: number;
  conversionRate: number;
}

export interface PlaceOrderParams {
  symbol: GmoSymbol;
  side: "BUY" | "SELL";
  executionType: "MARKET" | "LIMIT" | "STOP";
  size: number;
  price?: number;
  /** LIMIT のみ有効。`postOnly=true` で maker 専用（約定で taker になるなら reject） */
  timeInForce?: "FAK" | "FAS" | "FOK" | "SOK";
}

export interface PlaceOrderResult {
  orderId: string;
}

export interface ActiveOrder {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  executionType: string;
  size: number;
  price: number;
  status: string;
  timestamp: string;
  executedSize?: number;
}

export interface Execution {
  executionId: string;
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  settleType: string;
  size: number;
  price: number;
  lossGain: number;
  fee: number;
  timestamp: string;
}

interface GmoResponseEnvelope<T> {
  status: number;
  data?: T;
  messages?: Array<{ message_code: string; message_string: string }>;
  responsetime: string;
}

export class GmoApiError extends Error {
  readonly httpStatus: number;
  readonly gmoStatus: number;
  readonly messages?: Array<{ message_code: string; message_string: string }>;
  readonly rawBody?: unknown;

  constructor(
    message: string,
    httpStatus: number,
    gmoStatus: number,
    messages?: Array<{ message_code: string; message_string: string }>,
    rawBody?: unknown,
  ) {
    super(message);
    this.name = "GmoApiError";
    this.httpStatus = httpStatus;
    this.gmoStatus = gmoStatus;
    this.messages = messages;
    this.rawBody = rawBody;
  }
}

export class GmoClient {
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly fetchImpl: typeof fetch;

  constructor(config: GmoClientConfig) {
    if (!config.apiKey || !config.apiSecret) {
      throw new Error("GmoClient: apiKey and apiSecret are required");
    }
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
    this.fetchImpl = config.fetchImpl ?? fetch;
  }

  async getTicker(symbol: GmoSymbol): Promise<Ticker> {
    const url = `${PUBLIC_BASE_URL}/v1/ticker?symbol=${symbol}`;
    const envelope = await this.fetchJson<Ticker[]>(url, { method: "GET" });
    const data = this.unwrap(envelope);
    const [first] = data;
    if (!first) {
      throw new GmoApiError(
        `GMO ticker returned empty data for ${symbol}`,
        200,
        envelope.status,
        envelope.messages,
        envelope,
      );
    }
    return {
      ...first,
      ask: Number(first.ask),
      bid: Number(first.bid),
      last: Number(first.last),
      high: Number(first.high),
      low: Number(first.low),
      volume: Number(first.volume),
    };
  }

  async getAccountAssets(): Promise<AccountAsset[]> {
    const path = "/v1/account/assets";
    const envelope = await this.privateRequest<Array<Record<string, unknown>>>(
      "GET",
      path,
    );
    const data = this.unwrap(envelope);
    return data.map((row) => ({
      symbol: String(row.symbol),
      amount: Number(row.amount),
      available: Number(row.available),
      conversionRate: Number(row.conversionRate),
    }));
  }

  async placeOrder(params: PlaceOrderParams): Promise<PlaceOrderResult> {
    const path = "/v1/order";
    const body: Record<string, unknown> = {
      symbol: params.symbol,
      side: params.side,
      executionType: params.executionType,
      size: String(params.size),
    };
    if (params.price !== undefined) body.price = String(params.price);
    if (params.timeInForce) body.timeInForce = params.timeInForce;

    const envelope = await this.privateRequest<string>("POST", path, body);
    const data = this.unwrap(envelope);
    return { orderId: String(data) };
  }

  async cancelOrder(orderId: string): Promise<void> {
    const path = "/v1/cancelOrder";
    const envelope = await this.privateRequest<unknown>("POST", path, {
      orderId,
    });
    this.unwrap(envelope);
  }

  async getActiveOrders(symbol?: GmoSymbol): Promise<ActiveOrder[]> {
    const path = symbol
      ? `/v1/activeOrders?symbol=${symbol}`
      : "/v1/activeOrders";
    const envelope = await this.privateRequest<{
      list?: Array<Record<string, unknown>>;
    }>("GET", path);
    const data = this.unwrap(envelope);
    const list = data.list ?? [];
    return list.map((row) => ({
      orderId: String(row.orderId),
      symbol: String(row.symbol),
      side: row.side as "BUY" | "SELL",
      executionType: String(row.executionType),
      size: Number(row.size),
      price: Number(row.price),
      status: String(row.status),
      timestamp: String(row.timestamp),
      executedSize:
        row.executedSize !== undefined ? Number(row.executedSize) : undefined,
    }));
  }

  async getLatestExecutions(symbol?: GmoSymbol): Promise<Execution[]> {
    const path = symbol
      ? `/v1/latestExecutions?symbol=${symbol}`
      : "/v1/latestExecutions";
    const envelope = await this.privateRequest<{
      list?: Array<Record<string, unknown>>;
    }>("GET", path);
    const data = this.unwrap(envelope);
    const list = data.list ?? [];
    return list.map((row) => ({
      executionId: String(row.executionId),
      orderId: String(row.orderId),
      symbol: String(row.symbol),
      side: row.side as "BUY" | "SELL",
      settleType: String(row.settleType),
      size: Number(row.size),
      price: Number(row.price),
      lossGain: Number(row.lossGain),
      fee: Number(row.fee),
      timestamp: String(row.timestamp),
    }));
  }

  private async privateRequest<T>(
    method: "GET" | "POST",
    path: string,
    body?: Record<string, unknown>,
  ): Promise<GmoResponseEnvelope<T>> {
    const timestamp = Date.now().toString();
    const pathForSign = path.split("?")[0] ?? path;
    const bodyText = body ? JSON.stringify(body) : "";
    const signSource = timestamp + method + pathForSign + bodyText;
    const sign = crypto
      .createHmac("sha256", this.apiSecret)
      .update(signSource)
      .digest("hex");

    const headers: Record<string, string> = {
      "API-KEY": this.apiKey,
      "API-TIMESTAMP": timestamp,
      "API-SIGN": sign,
    };
    if (method === "POST") headers["Content-Type"] = "application/json";

    const url = `${PRIVATE_BASE_URL}${path}`;
    return this.fetchJson<T>(url, {
      method,
      headers,
      body: body ? bodyText : undefined,
    });
  }

  private async fetchJson<T>(
    url: string,
    init: RequestInit,
  ): Promise<GmoResponseEnvelope<T>> {
    const res = await this.fetchImpl(url, init);
    const text = await res.text();
    let parsed: GmoResponseEnvelope<T> | undefined;
    try {
      parsed = text ? (JSON.parse(text) as GmoResponseEnvelope<T>) : undefined;
    } catch {
      throw new GmoApiError(
        `GMO response was not JSON: ${text.slice(0, 200)}`,
        res.status,
        -1,
        undefined,
        text,
      );
    }
    if (!res.ok || !parsed) {
      throw new GmoApiError(
        `GMO HTTP ${res.status}: ${text.slice(0, 200)}`,
        res.status,
        parsed?.status ?? -1,
        parsed?.messages,
        parsed ?? text,
      );
    }
    return parsed;
  }

  private unwrap<T>(envelope: GmoResponseEnvelope<T>): T {
    if (envelope.status !== 0 || envelope.data === undefined) {
      const msg =
        envelope.messages?.map((m) => m.message_string).join("; ") ??
        "unknown error";
      throw new GmoApiError(
        `GMO API error: ${msg}`,
        200,
        envelope.status,
        envelope.messages,
        envelope,
      );
    }
    return envelope.data;
  }
}
