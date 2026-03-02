#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/_helpers.sh"
INPUT=$(cat)

# Extract fields — TOOL_INPUT extracted separately to preserve JSON quoting
eval "$(echo "$INPUT" | jq -r '
  @sh "TOOL_NAME=\(.tool_name // "unknown")",
  @sh "HOOK_EVENT=\(.hook_event_name // "PostToolUse")",
  @sh "SESSION_ID=\(.session_id // "")",
  @sh "AGENT_ID=\(.agent_id // "")",
  @sh "ERROR_MSG=\(.error // "" | tostring | .[:100])"
' | tr ',' '\n')"
TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // null')

# Sanitize for safe temp file paths
SESSION_ID_SAFE=$(echo "$SESSION_ID" | tr -cd 'a-zA-Z0-9_-')
TOOL_NAME_SAFE=$(echo "$TOOL_NAME" | tr -cd 'a-zA-Z0-9_-')

# Calculate duration from start timestamp
DURATION_MS=0
TIMING_DIR="/tmp/devscope-tool-times"
TIMING_FILE="${TIMING_DIR}/${SESSION_ID_SAFE}_${TOOL_NAME_SAFE}"
if [ -f "$TIMING_FILE" ]; then
  START_NS=$(cat "$TIMING_FILE")
  NOW_NS=$(_ds_now_ns)
  DURATION_MS=$(( (NOW_NS - START_NS) / 1000000 ))
  rm -f "$TIMING_FILE"
fi

if [ "$HOOK_EVENT" = "PostToolUseFailure" ]; then
  SUCCESS=false
  EVENT_TYPE="tool.fail"
else
  SUCCESS=true
  EVENT_TYPE="tool.complete"
  ERROR_MSG=""
fi

PAYLOAD=$(jq -n \
  --arg tn "$TOOL_NAME" \
  --argjson s "$SUCCESS" \
  --argjson d "$DURATION_MS" \
  --arg em "$ERROR_MSG" \
  --arg ai "$AGENT_ID" \
  --argjson ti "${TOOL_INPUT:-null}" \
  '{toolName: $tn, success: $s, duration: $d}
   | if $em != "" then . + {errorMessage: $em} else . end
   | if $ai != "" then . + {agentId: $ai} else . end
   | if $ti != null then . + {toolInput: $ti} else . end')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "$EVENT_TYPE" "$PAYLOAD"
