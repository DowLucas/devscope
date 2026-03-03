#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
. "$SCRIPT_DIR/_helpers.sh"
INPUT=$(cat)

PROMPT=$(echo "$INPUT" | jq -r '.prompt // ""')
PROMPT_LEN=${#PROMPT}
IS_CONT=$(echo "$INPUT" | jq -r '.is_continuation // false')

# Only include prompt text when the developer has opted in to detailed sharing
if _ds_share_details_enabled; then
  PAYLOAD=$(jq -n \
    --argjson pl "$PROMPT_LEN" \
    --argjson ic "$IS_CONT" \
    --arg pt "$PROMPT" \
    '{promptLength: $pl, isContinuation: $ic, promptText: $pt}')
else
  PAYLOAD=$(jq -n \
    --argjson pl "$PROMPT_LEN" \
    --argjson ic "$IS_CONT" \
    '{promptLength: $pl, isContinuation: $ic}')
fi

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "prompt.submit" "$PAYLOAD"
