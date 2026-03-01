#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

# Extract tools used from response
TOOLS_USED=$(echo "$INPUT" | jq -c '[.response.tools // [] | .[] | .name] // []' 2>/dev/null || echo '[]')

# Extract response length
RESPONSE_LENGTH=$(echo "$INPUT" | jq -r '.response.text // ""' 2>/dev/null | wc -c | tr -d ' ')

PAYLOAD=$(jq -n \
  --argjson tu "$TOOLS_USED" \
  --argjson rl "$RESPONSE_LENGTH" \
  '{toolsUsed: $tu, responseLength: $rl}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "response.complete" "$PAYLOAD"
