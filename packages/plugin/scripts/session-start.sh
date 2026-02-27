#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

START_TYPE=$(echo "$INPUT" | jq -r '.source // "startup"')
PERM_MODE=$(echo "$INPUT" | jq -r '.permission_mode // "default"')

PAYLOAD=$(jq -n --arg st "$START_TYPE" --arg pm "$PERM_MODE" \
  '{startType: $st, permissionMode: $pm}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "session.start" "$PAYLOAD"
