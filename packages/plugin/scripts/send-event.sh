#!/usr/bin/env bash
# Common event sender for DevScope
# Usage: echo '{"hook_input":"..."}' | send-event.sh <event_type> '<payload_json>'
set -euo pipefail

DEVSCOPE_URL="${DEVSCOPE_URL:-http://localhost:3001}"
EVENT_TYPE="$1"
INPUT=$(cat)

SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
PROJECT_NAME=$(basename "$CWD" 2>/dev/null || echo "unknown")

# Session continuity: use DevScope session ID if available
# PPID identifies the Claude Code process, keeping concurrent sessions separate
if [ -n "$CWD" ]; then
  _GC_DEV_EMAIL=$(git -C "$CWD" config user.email 2>/dev/null || echo "${USER}@local")
  _GC_HASH=$(echo -n "${_GC_DEV_EMAIL}:${CWD}:${PPID}" | sha256sum | cut -d' ' -f1)
  _GC_STATE="${HOME}/.cache/devscope/${_GC_HASH}.session"
  if [ -f "$_GC_STATE" ]; then
    _GC_SID=$(cat "$_GC_STATE")
    [ -n "$_GC_SID" ] && SESSION_ID="$_GC_SID"
  fi
fi

DEV_NAME=$(git -C "$CWD" config user.name 2>/dev/null || echo "$USER")
DEV_EMAIL=$(git -C "$CWD" config user.email 2>/dev/null || echo "${USER}@local")
DEV_ID=$(echo -n "$DEV_EMAIL" | sha256sum | cut -d' ' -f1)

PAYLOAD="${2:-$(echo "$INPUT" | jq -c '{raw: .}')}"

EVENT_ID=$(cat /proc/sys/kernel/random/uuid 2>/dev/null || uuidgen 2>/dev/null || echo "evt-$(date +%s%N)")

TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ)

EVENT=$(jq -n \
  --arg id "$EVENT_ID" \
  --arg ts "$TIMESTAMP" \
  --arg sid "$SESSION_ID" \
  --arg did "$DEV_ID" \
  --arg dname "$DEV_NAME" \
  --arg ppath "$CWD" \
  --arg pname "$PROJECT_NAME" \
  --arg etype "$EVENT_TYPE" \
  --argjson payload "$PAYLOAD" \
  '{
    id: $id,
    timestamp: $ts,
    sessionId: $sid,
    developerId: $did,
    developerName: $dname,
    projectPath: $ppath,
    projectName: $pname,
    eventType: $etype,
    payload: $payload
  }')

CURL_ARGS=(-s -X POST "${DEVSCOPE_URL}/api/events"
  -H "Content-Type: application/json"
  -d "$EVENT"
  --max-time 5
  -o /dev/null)

if [ -n "${DEVSCOPE_API_KEY:-}" ]; then
  CURL_ARGS+=(-H "Authorization: Bearer ${DEVSCOPE_API_KEY}")
fi

curl "${CURL_ARGS[@]}" 2>/dev/null || true

exit 0
