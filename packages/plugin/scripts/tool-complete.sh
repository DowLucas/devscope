#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // "unknown"')
TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // {}')
HOOK_EVENT=$(echo "$INPUT" | jq -r '.hook_event_name // "PostToolUse"')

if [ "$HOOK_EVENT" = "PostToolUseFailure" ]; then
  SUCCESS=false
  EVENT_TYPE="tool.fail"
else
  SUCCESS=true
  EVENT_TYPE="tool.complete"
fi

PAYLOAD=$(jq -n \
  --arg tn "$TOOL_NAME" \
  --argjson ti "$TOOL_INPUT" \
  --argjson s "$SUCCESS" \
  '{toolName: $tn, toolInput: $ti, success: $s}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "$EVENT_TYPE" "$PAYLOAD"
