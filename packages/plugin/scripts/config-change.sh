#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

SOURCE=$(echo "$INPUT" | jq -r '.source // ""')
FILE_PATH=$(echo "$INPUT" | jq -r '.file_path // ""')

PAYLOAD=$(jq -n \
  --arg s "$SOURCE" \
  --arg fp "$FILE_PATH" \
  '{source: $s, filePath: $fp}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "config.change" "$PAYLOAD"
