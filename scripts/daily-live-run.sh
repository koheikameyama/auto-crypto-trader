#!/bin/bash
# Daily live rebalance run for Scheme E (BTC + ETH).
# Started/stopped sidecar around each run. Safe to re-run same day.
# Exit codes: 0 = success, non-zero = error.

set -euo pipefail

REPO_DIR="/Users/kouheikameyama/development/auto-crypto-trader"
cd "$REPO_DIR"

# Load env config (SLACK_WEBHOOK_URL, DATABASE_URL, etc.) from repo-root .env
ENV_FILE="$REPO_DIR/.env"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

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

# Virtual rebalance — always runs (Phase 1.5)
echo "--- BTC-USD (Virtual) ---"
/Users/kouheikameyama/.asdf/shims/npx tsx scripts/live-rebalance.ts --asset=BTC-USD --initial-capital=10000

echo "--- ETH-USD (Virtual) ---"
/Users/kouheikameyama/.asdf/shims/npx tsx scripts/live-rebalance.ts --asset=ETH-USD --initial-capital=10000

# Actual execution — Phase 2, gated by EXECUTION_ENABLED.
# Set EXECUTION_ENABLED=true in .env to enable real GMO orders.
# EXECUTION_ASSETS comma-separated (default: BTC). Example: "BTC,ETH"
if [ "${EXECUTION_ENABLED:-false}" = "true" ]; then
  ASSETS="${EXECUTION_ASSETS:-BTC}"
  IFS=',' read -r -a ASSET_ARR <<< "$ASSETS"
  for A in "${ASSET_ARR[@]}"; do
    A="$(echo "$A" | tr -d '[:space:]')"
    echo "--- $A (Actual, GMO) ---"
    /Users/kouheikameyama/.asdf/shims/npx tsx scripts/live-execute.ts --asset="$A" || {
      echo "live-execute failed for $A (continuing)"
    }
  done
fi

# Slack notification (optional; only if SLACK_WEBHOOK_URL is set)
if [ -n "${SLACK_WEBHOOK_URL:-}" ]; then
  echo "--- Slack notify ---"
  bash "$REPO_DIR/scripts/slack-notify.sh" || echo "slack-notify failed (non-fatal)"
fi

echo "=== daily-live-run.sh finished $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
