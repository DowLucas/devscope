#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
INPUT=$(cat)

WORKTREE_PATH=$(echo "$INPUT" | jq -r '.worktree_path // ""')

PAYLOAD=$(jq -n \
  --arg wp "$WORKTREE_PATH" \
  '{worktreePath: $wp}')

echo "$INPUT" | "$SCRIPT_DIR/send-event.sh" "worktree.remove" "$PAYLOAD"
