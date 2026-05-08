# Token Usage Tracking

DevScope captures Claude Code token consumption (input, output, cache creation, cache read)
and estimates per-session cost in USD. This document describes the shipped surfaces end-to-end.

## Architecture overview

```
Claude Code hook
  └─ plugin/scripts/response-stop.sh   (on every response.complete)
  └─ plugin/scripts/session-end.sh     (on session.end)
       └─ _ds_extract_token_usage()    (parses transcript JSONL)
            └─ POST /api/events        (tokenUsage field in payload)
                 └─ backend updateSessionTokens()
                      └─ sessions table  (cumulative totals + segment peaks)
                      └─ token_pricing table  (model-pattern → USD/Mtok rates)
                           └─ GET /api/insights/tokens
                           └─ GET /api/insights/tokens/over-time
                                └─ dashboard TokenUsageCards + TokenUsageChart
                                └─ session detail (self-view only)
```

## Plugin — transcript parsing

Because Claude Code hooks do not expose token counts directly in their JSON input,
the plugin extracts them from the `transcript_path` JSONL file attached to each hook call.

**Scripts:** `scripts/response-stop.sh`, `scripts/session-end.sh`  
**Helper:** `scripts/_helpers.sh` — `_ds_extract_token_usage()`

The helper reads the JSONL file backwards until it finds the last assistant message that
contains a `message.usage` object, then emits:

```json
{
  "inputTokens":          <input_tokens>,
  "outputTokens":         <output_tokens>,
  "cacheCreationTokens":  <cache_creation_input_tokens>,
  "cacheReadTokens":      <cache_read_input_tokens>
}
```

This object is merged into the event payload under the key `tokenUsage` before it is
POSTed to `POST /api/events`. If the transcript file is absent or unparseable, the field
is omitted and the backend treats the event as a no-token event (no cost accumulation).

**Parsing strategy:** `python3` is preferred (handles JSONL lines that contain embedded
newlines, e.g. code blocks). Falls back to `jq --rawfile` streaming for environments
without python3.

## Backend — storage and aggregation

### Database schema

**Migration `030_session_token_usage.sql`** adds to the `sessions` table:

| Column | Type | Description |
|---|---|---|
| `total_input_tokens` | `BIGINT` | Cumulative input tokens for the session |
| `total_output_tokens` | `BIGINT` | Cumulative output tokens |
| `total_cache_creation_tokens` | `BIGINT` | Cumulative cache-creation tokens |
| `total_cache_read_tokens` | `BIGINT` | Cumulative cache-read tokens |
| `estimated_cost_usd` | `NUMERIC(10,6)` | Estimated USD cost at current pricing |
| `segment_peak_input` | `BIGINT` | High-water mark within the current compaction segment |
| `segment_peak_output` | `BIGINT` | High-water mark (output) for compaction awareness |
| `segment_peak_cache_creation` | `BIGINT` | High-water mark (cache creation) |
| `segment_peak_cache_read` | `BIGINT` | High-water mark (cache read) |

The segment-peak columns exist because Claude Code's context-compaction resets the
running token total inside a session. The backend accumulates independent segments using
the high-water-mark technique so totals do not double-count pre-compaction tokens.

**Migration `038_token_pricing_model_patterns.sql`** seeds per-model-tier rows in
`token_pricing`:

| Column | Description |
|---|---|
| `id` | Stable row id used by upserts |
| `model_pattern` | SQL `LIKE` pattern, e.g. `claude-opus-4-%`; or `*` for the fallback |
| `input_price_per_mtok` | USD per million input tokens |
| `output_price_per_mtok` | USD per million output tokens |
| `cache_creation_price_per_mtok` | USD per million cache-creation tokens |
| `cache_read_price_per_mtok` | USD per million cache-read tokens |

Seeded tiers (as of 2026-05-08): Sonnet-4, Opus-4, Haiku-4.5, Haiku-3.5, plus `*` fallback.

### Accumulation logic

`updateSessionTokens()` in `packages/backend/src/db/queries.ts`:

1. Receives the `tokenUsage` field from an incoming event.
2. Computes the delta from the segment-peak columns (handling compaction resets).
3. Adds the delta to the cumulative totals.
4. Selects the pricing row via `CROSS JOIN LATERAL` — longest `model_pattern` LIKE-match
   against `sessions.model`, falling back to `*` — and updates `estimated_cost_usd`.

For a detailed runbook on updating pricing, see
[`packages/backend/docs/token-pricing.md`](../packages/backend/docs/token-pricing.md).

### API endpoints

| Endpoint | Description |
|---|---|
| `GET /api/insights/tokens` | Team-wide aggregate totals (input, output, cache, cost) |
| `GET /api/insights/tokens/over-time` | Time-series token usage (bucketed by day) |
| `GET /api/sessions` | Session list includes `totalInputTokens`, `totalOutputTokens`, `totalCacheCreationTokens`, `totalCacheReadTokens`, `estimatedCostUsd` per session |
| `GET /api/sessions/:id` | Session detail includes the same fields |

The `/api/insights/tokens` endpoints **do not** accept a `?developerId=` filter and
ignore it if supplied — token aggregates are always team-scoped (see
[Ethics/privacy](#ethicsprivacy) below).

## Dashboard — visualisation

### Team-level (InsightsOverview)

`packages/dashboard/src/components/insights/`

- **`TokenUsageCards`** — three summary cards: total tokens (input + output + cache),
  estimated cost, and cache hit rate (cache-read / total input). Always team-scoped.
- **`TokenUsageChart`** — stacked area chart showing input / output / cache token
  volumes over time, driven by `/api/insights/tokens/over-time`.

### Session-level (SessionDetail)

`packages/dashboard/src/components/session/SessionDetail.tsx`

Per-session token counts and estimated cost are displayed only when `isSelfView` is true
(the viewer is the session's owner). Org-level viewers see project, duration, and tool
counts for a teammate's session, but **not** token totals or cost — those are an
individual productivity proxy and are kept private.

## Ethics/privacy

Token tracking is built to team workflow visibility, not individual surveillance:

- **Aggregate views are team-scoped.** `/api/insights/tokens` sums across all developers
  in the org; there is no per-developer breakdown endpoint.
- **Per-session token data is self-view only.** `SessionDetail` hides token + cost fields
  from any viewer who is not the session owner.
- **Backend guardrail.** A regression test asserts that both insights endpoints ignore any
  `?developerId=` parameter and always use the full `orgDeveloperIds` scope.
- **Leaderboard guardrail.** A code-search test scans the dashboard source tree for
  textual fingerprints of a per-developer token ranking or sort; any new match must be
  explicitly allowed or the test fails.

## Related PRs and issues

- Initial implementation: `feat: token usage tracking across plugin, backend, and dashboard` (commit `99652ae`)
- Mission audit + leaderboard regression coverage: PR #56 (DEV-98, merged)
- Model-pattern pricing + runbook: PR #57 (DEV-99)
- Upstream tracking issue: DowLucas/devscope#1 (closed by this PR)
