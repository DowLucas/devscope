#!/usr/bin/env bash
# Cross-platform helpers for DevScope plugin scripts
# Sourced by other scripts — not executed directly

# Load config: env var > config file > default
if [ -z "${DEVSCOPE_URL:-}" ]; then
  _DS_CONFIG="${XDG_CONFIG_HOME:-$HOME/.config}/devscope/config"
  if [ -f "$_DS_CONFIG" ]; then
    # shellcheck disable=SC1090
    . "$_DS_CONFIG"
  fi
fi
DEVSCOPE_URL="${DEVSCOPE_URL:-http://localhost:3001}"

# SHA256 hash — works on Linux, macOS, and BSDs
_ds_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    echo -n "$1" | sha256sum | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    echo -n "$1" | shasum -a 256 | cut -d' ' -f1
  else
    echo -n "$1" | openssl dgst -sha256 -r | cut -d' ' -f1
  fi
}

# Nanosecond timestamp — Linux uses GNU date, macOS falls back to python3/perl/seconds
_ds_now_ns() {
  local ns
  ns=$(date +%s%N 2>/dev/null)
  # macOS date prints literal "%sN" or similar when %N is unsupported
  if [ "${ns##*[!0-9]*}" != "$ns" ] || [ -z "$ns" ]; then
    ns=$(python3 -c 'import time; print(int(time.time() * 1e9))' 2>/dev/null) || \
    ns=$(perl -MTime::HiRes=time -e 'printf "%d\n", time*1e9' 2>/dev/null) || \
    ns="$(date +%s)000000000"
  fi
  echo "$ns"
}

# ISO 8601 timestamp with milliseconds
_ds_timestamp() {
  local ts
  ts=$(date -u +%Y-%m-%dT%H:%M:%S.%3NZ 2>/dev/null)
  # macOS BSD date doesn't support %N — check for non-digit in milliseconds
  if echo "$ts" | grep -qE '\.[^0-9]'; then
    ts=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
  fi
  echo "$ts"
}
