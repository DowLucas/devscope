#!/usr/bin/env bash
# DevScope worker sandbox entrypoint.
# Reads a candidate JSON object on STDIN, runs the agent + verifier
# pipeline against a freshly-cloned copy of the target repo, and
# emits a single artifact JSON object on STDOUT.
#
# Failure handling: any error becomes a structured
#   {"status":"failed","reason":"..."} on STDOUT, exit 0.
# The host (Task 5.2) prefers parsing structured failure to inferring
# from a non-zero exit code.
set -euo pipefail

# Emit a structured failure to stdout and exit 0.
fail() {
    local reason="$1"
    # jq -nc to safely encode the reason string.
    jq -nc --arg reason "$reason" '{status:"failed", reason:$reason}'
    exit 0
}

# Trap unexpected errors → structured failure.
trap 'fail "internal error at line $LINENO"' ERR

CANDIDATE_PATH="/tmp/candidate.json"
DRAFT_PATH="/tmp/draft.json"
VERIFY_PATH="/tmp/verify.json"
CLONE_PATH="/work/repo"

# 1. Read candidate JSON from STDIN.
cat > "$CANDIDATE_PATH"

# 2. Validate required fields. jq -e exits non-zero if any are null/missing.
jq -e '.id and .repo_clone_url and .repo_default_branch and .kind' \
    "$CANDIDATE_PATH" >/dev/null \
    || fail "candidate missing required field (id, repo_clone_url, repo_default_branch, kind)"

CANDIDATE_ID=$(jq -r '.id' "$CANDIDATE_PATH")
KIND=$(jq -r '.kind' "$CANDIDATE_PATH")
DEFAULT_BRANCH=$(jq -r '.repo_default_branch' "$CANDIDATE_PATH")
# Clone URL contains an installation token. Read into a variable;
# never echo it, never pass on visible argv outside of git itself.
CLONE_URL=$(jq -r '.repo_clone_url' "$CANDIDATE_PATH")

# 3. Clone shallowly. Disable terminal prompts so a bad token fails fast.
#    GIT_TERMINAL_PROMPT=0 prevents git from blocking on credential prompts.
export GIT_TERMINAL_PROMPT=0
if ! GIT_OUT=$(git clone --depth 1 --quiet --branch "$DEFAULT_BRANCH" \
        "$CLONE_URL" "$CLONE_PATH" 2>&1); then
    # Strip the URL out of any error string before surfacing it — the URL
    # contains the token and must not leak to logs / artifact JSON.
    SAFE_OUT=${GIT_OUT//$CLONE_URL/[redacted]}
    fail "git clone failed: ${SAFE_OUT:0:200}"
fi
unset CLONE_URL

# 4. Agent driver — Claude tool-use loop emits a draft JSON to stdout.
#    Stderr is discarded; the agent itself writes failure diagnostics into
#    the draft JSON via the `error` field rather than crashing.
if ! bun run /app/agent/runAgent.ts < "$CANDIDATE_PATH" > "$DRAFT_PATH" 2>/dev/null; then
    fail "agent driver failed"
fi

# 5. Verifier (SKELETON — Task 5.4 fills in remaining gates).
export DEVSCOPE_KIND="$KIND"
export DEVSCOPE_CLONE_PATH="$CLONE_PATH"
if ! bun run /app/verify/verifyPatch.ts < "$DRAFT_PATH" > "$VERIFY_PATH" 2>/dev/null; then
    fail "verifier failed"
fi

# 6. Compose final artifact and emit on STDOUT.
jq -nc \
    --arg candidate_id "$CANDIDATE_ID" \
    --arg kind "$KIND" \
    --slurpfile draft "$DRAFT_PATH" \
    --slurpfile verify "$VERIFY_PATH" \
    '{
        status: "completed",
        candidate_id: $candidate_id,
        kind: $kind,
        draft: $draft[0],
        verification: $verify[0]
    }'

# 7. Cleanup. tmpfs will evaporate, but be explicit.
rm -rf "$CLONE_PATH" "$CANDIDATE_PATH" "$DRAFT_PATH" "$VERIFY_PATH"
