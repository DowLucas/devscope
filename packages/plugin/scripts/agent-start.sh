#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

AGENT_TYPE=$(echo "$INPUT" | jq -r '.agent_type // "unknown"')
AGENT_ID=$(echo "$INPUT" | jq -r '.agent_id // ""')

PAYLOAD=$(jq -n --arg at "$AGENT_TYPE" --arg ai "$AGENT_ID" \
  '{agentType: $at, agentId: $ai}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "agent.start" "$PAYLOAD"
