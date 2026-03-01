#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

END_REASON=$(echo "$INPUT" | jq -r '.source // "other"')

PAYLOAD=$(jq -n --arg er "$END_REASON" '{endReason: $er}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "session.end" "$PAYLOAD"

# Clean up the session state file
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
if [ -n "$CWD" ]; then
  _GC_DEV_EMAIL=$(git -C "$CWD" config user.email 2>/dev/null || echo "${USER}@local")
  _GC_HASH=$(echo -n "${_GC_DEV_EMAIL}:${CWD}:${PPID}" | sha256sum | cut -d' ' -f1)
  rm -f "${HOME}/.cache/devscope/${_GC_HASH}.session"
fi
