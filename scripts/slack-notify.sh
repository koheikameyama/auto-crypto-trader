#!/bin/bash
# Post today's live-rebalance result summary to Slack.
# Env: SLACK_WEBHOOK_URL (required)
# Reads reports/live/YYYY-MM-DD-{BTC,ETH}-USD-portfolio.json.

set -euo pipefail

if [ -z "${SLACK_WEBHOOK_URL:-}" ]; then
  echo "SLACK_WEBHOOK_URL not set, skipping"
  exit 0
fi

REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_DIR"

DATE="$(date -u +%Y-%m-%d)"
BTC_JSON="reports/live/${DATE}-BTC-USD-portfolio.json"
ETH_JSON="reports/live/${DATE}-ETH-USD-portfolio.json"

# Helpers (bc needed for float math)
to_pct() {
  # $1 is a decimal like 0.677, output "67.7%"
  printf '%.1f%%' "$(echo "$1 * 100" | bc -l)"
}

to_usd() {
  # $1 is a decimal, output "$9,993.21"
  printf '$%.2f' "$1"
}

build_section() {
  local label="$1" file="$2"
  if [ ! -f "$file" ]; then
    printf '*%s*\n(no report)\n' "$label"
    return
  fi
  local price target equity cumret rebalanced fee
  price=$(jq -r '.price' "$file")
  target=$(jq -r '.signal.targetPosition' "$file")
  equity=$(jq -r '.portfolio.equityUsd' "$file")
  cumret=$(jq -r '.cumulative.return' "$file")
  rebalanced=$(jq -r '.portfolio.rebalancedToday' "$file")
  fee=$(jq -r '.portfolio.feeUsd' "$file")

  local reb_emoji="—"
  [ "$rebalanced" = "true" ] && reb_emoji="✅"

  local cumret_pct
  cumret_pct=$(printf '%+.2f%%' "$(echo "$cumret * 100" | bc -l)")

  printf '*%s*\n' "$label"
  printf '• Price: %s\n' "$(to_usd "$price")"
  printf '• Target: %s long\n' "$(to_pct "$target")"
  printf '• Equity: %s (%s)\n' "$(to_usd "$equity")" "$cumret_pct"
  printf '• Rebalanced: %s (fee %s)\n' "$reb_emoji" "$(to_usd "$fee")"
}

TEXT=$(
  {
    printf '📊 *Scheme E Daily Run* — %s\n\n' "$DATE"
    build_section "BTC-USD" "$BTC_JSON"
    printf '\n'
    build_section "ETH-USD" "$ETH_JSON"
  }
)

# Build Slack payload (plain text channel message)
PAYLOAD=$(jq -nc --arg t "$TEXT" '{text: $t}')

# Post
HTTP_CODE=$(curl -sS -o /tmp/slack-response.txt -w "%{http_code}" -X POST \
  -H 'Content-Type: application/json' \
  --data "$PAYLOAD" \
  "$SLACK_WEBHOOK_URL")

if [ "$HTTP_CODE" != "200" ]; then
  echo "Slack notify failed: HTTP $HTTP_CODE"
  cat /tmp/slack-response.txt || true
  exit 1
fi

echo "Slack notify OK"
