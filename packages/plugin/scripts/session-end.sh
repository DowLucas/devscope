#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/_helpers.sh"
INPUT=$(cat)

END_REASON=$(echo "$INPUT" | jq -r '.reason // "other"')

PAYLOAD=$(jq -n --arg er "$END_REASON" '{endReason: $er}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "session.end" "$PAYLOAD"

# Clean up the session state file
CWD=$(echo "$INPUT" | jq -r '.cwd // empty')
if [ -n "$CWD" ]; then
  _GC_DEV_EMAIL=$(git -C "$CWD" config user.email 2>/dev/null || echo "${USER}@local")
  _GC_HASH=$(_ds_sha256 "${_GC_DEV_EMAIL}:${CWD}:${PPID}")
  rm -f "${HOME}/.cache/devscope/${_GC_HASH}.session"
fi
