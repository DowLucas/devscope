#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

WORKTREE_NAME=$(echo "$INPUT" | jq -r '.name // ""')

PAYLOAD=$(jq -n \
  --arg wn "$WORKTREE_NAME" \
  '{worktreeName: $wn}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "worktree.create" "$PAYLOAD"
