#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""')
PROMPT_LEN=${#PROMPT}
IS_CONT=$(echo "$INPUT" | jq -r '.is_continuation // false')

PAYLOAD=$(jq -n \
  --arg pc "$PROMPT" \
  --argjson pl "$PROMPT_LEN" \
  --argjson ic "$IS_CONT" \
  '{promptContent: $pc, promptLength: $pl, isContinuation: $ic}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "prompt.submit" "$PAYLOAD"
