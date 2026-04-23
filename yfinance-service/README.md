# yfinance-service (crypto)

Python FastAPI service that exposes cryptocurrency daily bars (BTC-USD / ETH-USD) from yfinance.

Runs on port **8766** by default (to avoid clashing with the FX sidecar on 8765).

## Setup (fish shell)

```fish
cd yfinance-service
python3 -m venv .venv
source .venv/bin/activate.fish
pip install -r requirements.txt
```

## Run

```fish
uvicorn main:app --host 0.0.0.0 --port 8766
```

Or via the module entrypoint (reads `YFINANCE_PORT`, defaults to 8766):

```fish
python main.py
```

## Environment variables

| Variable          | Required | Description                                                                                   |
| ----------------- | -------- | --------------------------------------------------------------------------------------------- |
| `YFINANCE_PORT`   | no       | Port for the sidecar. Defaults to `8766`.                                                     |
| `YFINANCE_PROXY`  | no       | Proxy URL used as fallback when Yahoo Finance rate-limits the direct connection. Format: `http://user:pass@host:port`. |
| `SIDECAR_SECRET`  | no       | Shared secret for simple auth. If set, every request except `/health` must send `x-api-key: <SIDECAR_SECRET>`. |

## Endpoints

- `GET /health` — returns `{"status": "ok"}`. No auth required.
- `GET /crypto/daily?ticker=<ticker>&start=<YYYY-MM-DD>&end=<YYYY-MM-DD>` — returns `{"ticker": "...", "bars": [{date, open, high, low, close, volume}, ...]}`.

## Example

```bash
curl 'http://localhost:8766/crypto/daily?ticker=BTC-USD&start=2024-01-01&end=2024-02-01'
```

## Notes

- Same session-pool / retry / rate-limit handling as the FX sidecar
  (`curl_cffi` Chrome impersonation, asyncio semaphore, 1-second pacing,
  cookie refresh on rate-limit, optional proxy fallback).
- `require_positive_close=True` is enforced so any rows with zero/negative
  closes are dropped (defensive for BTC's very early thin-data era).
