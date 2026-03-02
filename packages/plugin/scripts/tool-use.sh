#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/_helpers.sh"
INPUT=$(cat)

# Extract fields — TOOL_INPUT extracted separately to preserve JSON quoting
eval "$(echo "$INPUT" | jq -r '
  @sh "TOOL_NAME=\(.tool_name // "unknown")",
  @sh "SESSION_ID=\(.session_id // "")",
  @sh "AGENT_ID=\(.agent_id // "")"
' | tr ',' '\n')"
TOOL_INPUT=$(echo "$INPUT" | jq -c '.tool_input // null')

# Sanitize for safe temp file paths
SESSION_ID_SAFE=$(echo "$SESSION_ID" | tr -cd 'a-zA-Z0-9_-')
TOOL_NAME_SAFE=$(echo "$TOOL_NAME" | tr -cd 'a-zA-Z0-9_-')

# Write start timestamp for duration calculation
TIMING_DIR="/tmp/devscope-tool-times"
mkdir -p -m 0700 "$TIMING_DIR"
echo "$(_ds_now_ns)" > "${TIMING_DIR}/${SESSION_ID_SAFE}_${TOOL_NAME_SAFE}"

PAYLOAD=$(jq -n \
  --arg tn "$TOOL_NAME" \
  --arg ai "$AGENT_ID" \
  --argjson ti "${TOOL_INPUT:-null}" \
  '{toolName: $tn} | if $ai != "" then . + {agentId: $ai} else . end | if $ti != null then . + {toolInput: $ti} else . end')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "tool.start" "$PAYLOAD"
