"""
yfinance サイドカーサービス (crypto 向け)

Yahoo Finance の仮想通貨 (BTC-USD / ETH-USD) 日足データを yfinance 経由で取得する
FastAPI サーバー。Node.js バックテストワーカーから localhost HTTP 経由で呼び出される。

FX 向けサービスと競合しないよう、デフォルトポートは 8766。
"""

import asyncio
import logging
import math
import os
import threading
from typing import Any, Callable, TypeVar

T = TypeVar("T")

import datetime
import urllib.request
import urllib.parse
import json

import uvicorn
import yfinance as yf
from curl_cffi.requests import Session as CurlSession
from fastapi import FastAPI, HTTPException, Request

try:
    from yfinance.exceptions import YFRateLimitError
except ImportError:
    YFRateLimitError = None  # type: ignore[misc,assignment]

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("yfinance-service-crypto")

app = FastAPI(title="yfinance sidecar (crypto)")

# ========================================
# 認証
# ========================================

SIDECAR_SECRET = os.environ.get("SIDECAR_SECRET", "")

# ========================================
# セッションプール（プロキシフォールバック対応）
# ========================================

PROXY = os.environ.get("YFINANCE_PROXY", "")
_SESSION_POOL_SIZE = 5

_direct_pool: list[CurlSession] = []
_direct_index = 0
_direct_lock = threading.Lock()

_proxy_pool: list[CurlSession] = []
_proxy_index = 0
_proxy_lock = threading.Lock()


def _create_session(*, use_proxy: bool = False) -> CurlSession:
    session = CurlSession(impersonate="chrome")
    if use_proxy and PROXY:
        session.proxies = {"http": PROXY, "https": PROXY}
    return session


def _init_session_pools() -> None:
    global _direct_pool, _proxy_pool
    _direct_pool = [_create_session(use_proxy=False) for _ in range(_SESSION_POOL_SIZE)]
    logger.info(f"Direct session pool initialized: {_SESSION_POOL_SIZE} sessions")
    if PROXY:
        _proxy_pool = [_create_session(use_proxy=True) for _ in range(_SESSION_POOL_SIZE)]
        proxy_display = PROXY.split("@")[-1] if "@" in PROXY else PROXY
        logger.info(f"Proxy session pool initialized: {_SESSION_POOL_SIZE} sessions, proxy={proxy_display}")
    else:
        logger.info("No proxy configured, proxy fallback disabled")


def get_session(*, use_proxy: bool = False) -> CurlSession:
    if use_proxy and PROXY:
        global _proxy_index
        with _proxy_lock:
            session = _proxy_pool[_proxy_index % _SESSION_POOL_SIZE]
            _proxy_index += 1
        return session
    else:
        global _direct_index
        with _direct_lock:
            session = _direct_pool[_direct_index % _SESSION_POOL_SIZE]
            _direct_index += 1
        return session


def _refresh_all_sessions(*, use_proxy: bool = False) -> None:
    if use_proxy and PROXY:
        with _proxy_lock:
            for i in range(_SESSION_POOL_SIZE):
                _proxy_pool[i] = _create_session(use_proxy=True)
        logger.info(f"All {_SESSION_POOL_SIZE} proxy sessions refreshed due to rate limit")
    else:
        with _direct_lock:
            for i in range(_SESSION_POOL_SIZE):
                _direct_pool[i] = _create_session(use_proxy=False)
        logger.info(f"All {_SESSION_POOL_SIZE} direct sessions refreshed due to rate limit")


_init_session_pools()


@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if request.url.path == "/health":
        return await call_next(request)
    if SIDECAR_SECRET:
        api_key = request.headers.get("x-api-key", "")
        if api_key != SIDECAR_SECRET:
            raise HTTPException(status_code=401, detail="Unauthorized")
    return await call_next(request)


# ========================================
# レート制限
# ========================================

_semaphore = asyncio.Semaphore(1)
_MIN_DELAY_S = 1.0
_REQUEST_TIMEOUT_S = 30.0


async def throttled(fn: Callable[[], T]) -> T:
    async with _semaphore:
        loop = asyncio.get_event_loop()
        result: T = await asyncio.wait_for(
            loop.run_in_executor(None, fn),  # type: ignore[arg-type]
            timeout=_REQUEST_TIMEOUT_S,
        )
        await asyncio.sleep(_MIN_DELAY_S)
        return result


# ========================================
# リトライ
# ========================================

_RETRY_MAX = 2
_RETRY_DELAY_S = 2.0


def _is_retryable(e: Exception) -> bool:
    if _is_rate_limit_error(e):
        return False
    if isinstance(e, (asyncio.TimeoutError, TimeoutError)):
        return True
    msg = str(e)
    if "has no attribute" in msg:
        return True
    if any(code in msg for code in ("ConnectionError", "Timeout", "ReadTimeout")):
        return True
    return False


async def throttled_with_retry(fn: Callable[[CurlSession], T]) -> T:
    last_error: Exception | None = None

    for attempt in range(_RETRY_MAX + 1):
        try:
            session = get_session(use_proxy=False)
            return await throttled(lambda: fn(session))
        except Exception as e:
            last_error = e
            if _is_rate_limit_error(e):
                _refresh_all_sessions(use_proxy=False)
                if not PROXY:
                    raise
                logger.info("Rate limited on direct connection, falling back to proxy")
                break
            if not _is_retryable(e) or attempt >= _RETRY_MAX:
                if not PROXY:
                    raise
                logger.info(f"Direct connection failed after {attempt + 1} attempt(s): {e}, falling back to proxy")
                break
            logger.warning(
                f"リトライ(direct) {attempt + 1}/{_RETRY_MAX} after {_RETRY_DELAY_S}s: {e}"
            )
            await asyncio.sleep(_RETRY_DELAY_S)
    else:
        raise last_error  # type: ignore[misc]

    for attempt in range(_RETRY_MAX + 1):
        try:
            session = get_session(use_proxy=True)
            return await throttled(lambda: fn(session))
        except Exception as e:
            last_error = e
            if _is_rate_limit_error(e):
                _refresh_all_sessions(use_proxy=True)
                raise
            if not _is_retryable(e) or attempt >= _RETRY_MAX:
                raise
            logger.warning(
                f"リトライ(proxy) {attempt + 1}/{_RETRY_MAX} after {_RETRY_DELAY_S}s: {e}"
            )
            await asyncio.sleep(_RETRY_DELAY_S)
    raise last_error  # type: ignore[misc]


# ========================================
# ユーティリティ
# ========================================

def _is_rate_limit_error(e: Exception) -> bool:
    if YFRateLimitError is not None and isinstance(e, YFRateLimitError):
        return True
    msg = str(e).lower()
    return "rate limit" in msg or "too many requests" in msg or "429" in msg


def _error_status(e: Exception) -> int:
    if _is_rate_limit_error(e):
        return 429
    if isinstance(e, (asyncio.TimeoutError, TimeoutError)):
        return 504
    return 500


def _error_detail(e: Exception) -> str:
    msg = str(e)
    if msg:
        return msg
    return f"{type(e).__name__}: request timed out after {_REQUEST_TIMEOUT_S}s"


def safe_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        f = float(value)
        return default if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return default


def safe_float_or_none(value: Any) -> float | None:
    if value is None:
        return None
    try:
        f = float(value)
        return None if math.isnan(f) or math.isinf(f) else f
    except (TypeError, ValueError):
        return None


def _flatten_columns(df) -> None:
    if hasattr(df, "columns") and hasattr(df.columns, "nlevels") and df.columns.nlevels > 1:
        df.columns = df.columns.get_level_values(0)


def _df_to_bars(df, *, require_positive_close: bool = False) -> list[dict]:
    if df is None or df.empty:
        return []
    _flatten_columns(df)
    bars = []
    for date, row in df.iterrows():
        o = safe_float_or_none(row.get("Open"))
        h = safe_float_or_none(row.get("High"))
        l = safe_float_or_none(row.get("Low"))
        c = safe_float_or_none(row.get("Close"))
        if o is None or h is None or l is None or c is None:
            continue
        if require_positive_close and c <= 0:
            continue
        ts = date if hasattr(date, "strftime") else date[1] if isinstance(date, tuple) else date
        bars.append({
            "date": ts.strftime("%Y-%m-%d"),
            "open": o,
            "high": h,
            "low": l,
            "close": c,
            "volume": safe_float(row.get("Volume")),
        })
    return bars


# ========================================
# エンドポイント
# ========================================

@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/crypto/daily")
async def crypto_daily(ticker: str, start: str, end: str):
    """
    仮想通貨の日足データを取得する。

    ticker: yfinance crypto ticker (e.g. 'BTC-USD', 'ETH-USD')
    start, end: 'YYYY-MM-DD'
    """
    try:
        def _fetch(session: CurlSession):
            t = yf.Ticker(ticker, session=session)
            df = t.history(start=start, end=end, interval="1d", auto_adjust=False)
            return df

        df = await throttled_with_retry(_fetch)
        bars = _df_to_bars(df, require_positive_close=True)
        return {"ticker": ticker, "bars": bars}
    except Exception as e:
        logger.error(f"Failed to fetch crypto/daily for {ticker}: {e}")
        raise HTTPException(status_code=_error_status(e), detail=_error_detail(e))


@app.get("/macro/daily")
async def macro_daily(ticker: str, start: str, end: str):
    """
    マクロ指標の日足データを取得する (DXY, VIX, gold, etc. 何でも yfinance 経由)。

    ticker: yfinance generic ticker (e.g. 'DX-Y.NYB', '^VIX', 'GC=F')
    start, end: 'YYYY-MM-DD'

    US 営業日のみ。週末・祝日は bar なし。caller 側で forward-fill 処理する。
    """
    try:
        def _fetch(session: CurlSession):
            t = yf.Ticker(ticker, session=session)
            df = t.history(start=start, end=end, interval="1d", auto_adjust=False)
            return df

        df = await throttled_with_retry(_fetch)
        bars = _df_to_bars(df, require_positive_close=False)
        return {"ticker": ticker, "bars": bars}
    except Exception as e:
        logger.error(f"Failed to fetch macro/daily for {ticker}: {e}")
        raise HTTPException(status_code=_error_status(e), detail=_error_detail(e))


# ========================================
# オンチェーン指標 (CoinMetrics Community API)
# ========================================

_COINMETRICS_BASE = "https://community-api.coinmetrics.io/v4/timeseries/asset-metrics"
_COINMETRICS_FREE_METRICS = "PriceUSD,CapMrktCurUSD,TxCnt,AdrActCnt"
_COINMETRICS_PAGE_LIMIT = 10000


def _fetch_coinmetrics_page(
    asset: str, metrics: str, start: str, end: str, next_page_token: str | None
) -> dict:
    params = {
        "assets": asset,
        "metrics": metrics,
        "start_time": start,
        "end_time": end,
        "frequency": "1d",
        "page_size": str(_COINMETRICS_PAGE_LIMIT),
    }
    if next_page_token:
        params["next_page_token"] = next_page_token
    url = f"{_COINMETRICS_BASE}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "auto-crypto-trader/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8")
    return json.loads(body)


@app.get("/onchain/daily")
async def onchain_daily(asset: str, start: str, end: str):
    """
    CoinMetrics Community API から BTC のオンチェーン指標を取得する。

    無料 tier のみ利用: PriceUSD / CapMrktCurUSD / TxCnt / AdrActCnt
    asset: 'btc' のみサポート（Round 4c スコープ）
    start, end: 'YYYY-MM-DD'
    """
    asset_lc = asset.lower()
    if asset_lc != "btc":
        raise HTTPException(
            status_code=400, detail=f"Only 'btc' is supported in free tier, got '{asset}'"
        )

    try:
        all_rows: list[dict] = []
        next_token: str | None = None
        while True:
            body = await asyncio.get_event_loop().run_in_executor(
                None,
                lambda: _fetch_coinmetrics_page(
                    asset_lc, _COINMETRICS_FREE_METRICS, start, end, next_token
                ),
            )
            rows = body.get("data", [])
            all_rows.extend(rows)
            next_token = body.get("next_page_token")
            if not next_token:
                break

        parsed: list[dict] = []
        for r in all_rows:
            ts = r.get("time", "")
            date_str = ts.split("T")[0] if "T" in ts else ts
            price = safe_float_or_none(r.get("PriceUSD"))
            cap = safe_float_or_none(r.get("CapMrktCurUSD"))
            tx = safe_float_or_none(r.get("TxCnt"))
            adr = safe_float_or_none(r.get("AdrActCnt"))
            if price is None or cap is None or tx is None or adr is None:
                continue
            parsed.append({
                "date": date_str,
                "priceUsd": price,
                "capMrktUsd": cap,
                "txCnt": int(tx),
                "adrActCnt": int(adr),
            })

        return {"asset": asset_lc, "bars": parsed}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to fetch onchain/daily for {asset}: {e}")
        raise HTTPException(status_code=500, detail=str(e) or type(e).__name__)


# ========================================
# Binance Futures Funding Rate
# ========================================

_BINANCE_FUNDING_URL = "https://fapi.binance.com/fapi/v1/fundingRate"
_BINANCE_PAGE_LIMIT = 1000


def _fetch_binance_funding_page(
    symbol: str, start_ms: int | None, end_ms: int | None
) -> list[dict]:
    params: dict[str, str] = {
        "symbol": symbol,
        "limit": str(_BINANCE_PAGE_LIMIT),
    }
    if start_ms is not None:
        params["startTime"] = str(start_ms)
    if end_ms is not None:
        params["endTime"] = str(end_ms)
    url = f"{_BINANCE_FUNDING_URL}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": "auto-crypto-trader/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


@app.get("/funding/daily")
async def funding_daily(symbol: str, start: str, end: str):
    """
    Binance USDT-M perp funding rate を取得して日次集計する。

    symbol: 'BTCUSDT' etc.
    start, end: 'YYYY-MM-DD'
    Returns: [{ date, avgRate, count }] (UTC 日単位で 3 回分の mean)
    """
    try:
        start_dt = datetime.datetime.strptime(start, "%Y-%m-%d").replace(
            tzinfo=datetime.timezone.utc
        )
        end_dt = datetime.datetime.strptime(end, "%Y-%m-%d").replace(
            tzinfo=datetime.timezone.utc
        ) + datetime.timedelta(days=1)
        start_ms = int(start_dt.timestamp() * 1000)
        end_ms = int(end_dt.timestamp() * 1000)

        all_rows: list[dict] = []
        cursor_start = start_ms
        loop = asyncio.get_event_loop()
        while True:
            page = await loop.run_in_executor(
                None,
                lambda s=cursor_start: _fetch_binance_funding_page(symbol, s, end_ms),
            )
            if not page:
                break
            all_rows.extend(page)
            if len(page) < _BINANCE_PAGE_LIMIT:
                break
            last_time = page[-1].get("fundingTime")
            if last_time is None:
                break
            cursor_start = int(last_time) + 1
            if cursor_start > end_ms:
                break

        # Aggregate by UTC date
        by_date: dict[str, list[float]] = {}
        for row in all_rows:
            ft = row.get("fundingTime")
            rate_str = row.get("fundingRate", "0")
            if ft is None:
                continue
            rate = float(rate_str)
            d = datetime.datetime.fromtimestamp(int(ft) / 1000, tz=datetime.timezone.utc)
            date_str = d.strftime("%Y-%m-%d")
            by_date.setdefault(date_str, []).append(rate)

        result = []
        for date_str in sorted(by_date.keys()):
            rates = by_date[date_str]
            result.append({
                "date": date_str,
                "avgRate": sum(rates) / len(rates),
                "count": len(rates),
            })
        return {"symbol": symbol, "bars": result}
    except Exception as e:
        logger.error(f"Failed to fetch funding/daily for {symbol}: {e}")
        raise HTTPException(status_code=500, detail=str(e) or type(e).__name__)


# ========================================
# エントリーポイント
# ========================================

if __name__ == "__main__":
    port = int(os.environ.get("YFINANCE_PORT", "8766"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
