#!/bin/bash
# Daily live rebalance run for Scheme E (BTC + ETH).
# Started/stopped sidecar around each run. Safe to re-run same day.
# Exit codes: 0 = success, non-zero = error.

set -euo pipefail

REPO_DIR="/Users/kouheikameyama/development/auto-crypto-trader"
cd "$REPO_DIR"

# Logging
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "=== daily-live-run.sh started $TS ==="

# Start sidecar in background
SIDECAR_DIR="$REPO_DIR/yfinance-service"
cd "$SIDECAR_DIR"
source .venv/bin/activate
python main.py >> /tmp/live-sidecar.log 2>&1 &
SIDECAR_PID=$!
echo "sidecar started pid=$SIDECAR_PID"

# Ensure sidecar is stopped on exit
cleanup() {
  echo "stopping sidecar pid=$SIDECAR_PID"
  kill "$SIDECAR_PID" 2>/dev/null || true
  wait "$SIDECAR_PID" 2>/dev/null || true
}
trap cleanup EXIT

# Wait for health (max 15 sec)
cd "$REPO_DIR"
for i in {1..15}; do
  if curl -sf http://localhost:8766/health > /dev/null; then
    echo "sidecar healthy after ${i}s"
    break
  fi
  sleep 1
  if [ "$i" -eq 15 ]; then
    echo "sidecar health check failed"
    exit 1
  fi
done

# Run BTC rebalance
echo "--- BTC-USD ---"
/Users/kouheikameyama/.asdf/shims/npx tsx scripts/live-rebalance.ts --asset=BTC-USD --initial-capital=10000

# Run ETH rebalance
echo "--- ETH-USD ---"
/Users/kouheikameyama/.asdf/shims/npx tsx scripts/live-rebalance.ts --asset=ETH-USD --initial-capital=10000

echo "=== daily-live-run.sh finished $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
