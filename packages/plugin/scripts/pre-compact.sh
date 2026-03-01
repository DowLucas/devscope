#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

TRIGGER=$(echo "$INPUT" | jq -r '.trigger // "auto"')
HAS_CUSTOM=$(echo "$INPUT" | jq 'if (.custom_instructions // "") != "" then true else false end')

PAYLOAD=$(jq -n \
  --arg tr "$TRIGGER" \
  --argjson hci "$HAS_CUSTOM" \
  '{trigger: $tr, hasCustomInstructions: $hci}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "compact.pending" "$PAYLOAD"
