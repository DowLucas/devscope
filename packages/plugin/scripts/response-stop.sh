#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

PAYLOAD=$(jq -n '{toolsUsed: []}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "response.complete" "$PAYLOAD"
