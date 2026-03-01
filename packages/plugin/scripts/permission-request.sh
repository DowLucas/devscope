#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')

PAYLOAD=$(jq -n \
  --arg tn "$TOOL_NAME" \
  '{toolName: $tn}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "permission.request" "$PAYLOAD"
