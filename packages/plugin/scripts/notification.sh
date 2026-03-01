#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

NOTIFICATION_TYPE=$(echo "$INPUT" | jq -r '.notification_type // "info"')
TITLE=$(echo "$INPUT" | jq -r '.title // ""')
MESSAGE=$(echo "$INPUT" | jq -r '.message // "" | .[:100]')

PAYLOAD=$(jq -n \
  --arg nt "$NOTIFICATION_TYPE" \
  --arg t "$TITLE" \
  --arg m "$MESSAGE" \
  '{notificationType: $nt, title: $t, message: $m}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "notification" "$PAYLOAD"
