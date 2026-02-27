#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

END_REASON=$(echo "$INPUT" | jq -r '.source // "other"')

PAYLOAD=$(jq -n --arg er "$END_REASON" '{endReason: $er}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "session.end" "$PAYLOAD"
