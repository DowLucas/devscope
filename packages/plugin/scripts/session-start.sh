#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/_helpers.sh"
INPUT=$(cat)

START_TYPE=$(echo "$INPUT" | jq -r '.source // "startup"')
PERM_MODE=$(echo "$INPUT" | jq -r '.permission_mode // "default"')
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
CC_SESSION_ID=$(echo "$INPUT" | jq -r '.session_id // empty')

# --- Session continuity state file ---
GC_CACHE_DIR="${HOME}/.cache/devscope"
mkdir -p "$GC_CACHE_DIR"
CONTINUED=false

if [ -n "$CWD" ] && [ -n "$CC_SESSION_ID" ]; then
  DEV_EMAIL=$(git -C "$CWD" config user.email 2>/dev/null || echo "${USER}@local")
  # Include PPID so concurrent sessions in the same project get separate state files.
  # PPID = Claude Code process PID, consistent across context clears but unique per instance.
  PROJECT_HASH=$(_ds_sha256 "${DEV_EMAIL}:${CWD}:${PPID}")
  STATE_FILE="${GC_CACHE_DIR}/${PROJECT_HASH}.session"

  if [ "$START_TYPE" = "startup" ]; then
    # New logical session — write CC session_id to state file
    echo "$CC_SESSION_ID" > "$STATE_FILE"
  else
    # clear/resume/compact — preserve existing DevScope session
    if [ -f "$STATE_FILE" ]; then
      CONTINUED=true
    else
      # No state file yet (edge case) — treat as new session
      echo "$CC_SESSION_ID" > "$STATE_FILE"
    fi
  fi
fi

PAYLOAD=$(jq -n \
  --arg st "$START_TYPE" \
  --arg pm "$PERM_MODE" \
  --argjson cont "$CONTINUED" \
  --arg ccid "$CC_SESSION_ID" \
  '{startType: $st, permissionMode: $pm, continued: $cont, claudeSessionId: $ccid}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "session.start" "$PAYLOAD"
