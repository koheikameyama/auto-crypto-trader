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


# ========================================
# エントリーポイント
# ========================================

if __name__ == "__main__":
    port = int(os.environ.get("YFINANCE_PORT", "8766"))
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
