#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

# Extract response length from last_assistant_message
RESPONSE_LENGTH=$(echo "$INPUT" | jq -r '.last_assistant_message // ""' 2>/dev/null | wc -c | tr -d ' ')

PAYLOAD=$(jq -n \
  --argjson rl "$RESPONSE_LENGTH" \
  '{responseLength: $rl}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "response.complete" "$PAYLOAD"
