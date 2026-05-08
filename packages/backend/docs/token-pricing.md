# Updating token pricing

DevScope estimates per-session API cost in USD from token counts emitted by the
plugin and a static pricing table. This runbook covers where the pricing lives,
when to refresh it, and how to verify a change.

## Where the seed lives

- Schema: migration `030_session_token_usage.sql` defines the `token_pricing`
  table and the original wildcard seed row.
- Active rates: migration `038_token_pricing_model_patterns.sql` seeds the
  per-model-tier rows (Sonnet-4, Opus-4, Haiku-4.5, Haiku-3.5) plus the `*`
  fallback. **Each future rate change adds a new migration that upserts the
  affected rows.** Do not edit a previously-shipped migration after it has
  been applied.
- Read path: `updateSessionTokens` in `packages/backend/src/db/queries.ts`
  joins `sessions.model` against `token_pricing.model_pattern` via SQL LIKE
  and picks the longest matching non-`*` row, falling back to `*`.

The columns are:

| Column                          | Meaning                                  |
| ------------------------------- | ---------------------------------------- |
| `id`                            | Stable row id used by the upsert         |
| `model_pattern`                 | SQL LIKE pattern (e.g. `claude-opus-4-%`) — or the literal `*` for the fallback row |
| `input_price_per_mtok`          | USD per million input tokens             |
| `output_price_per_mtok`         | USD per million output tokens            |
| `cache_creation_price_per_mtok` | USD per million cache-creation tokens    |
| `cache_read_price_per_mtok`     | USD per million cache-read tokens        |

## When to update

Update the seed when **any** of the following happen:

1. Anthropic changes published rates for a tier we already track (Sonnet-4,
   Opus-4, Haiku-4.5, Haiku-3.5).
2. A new model family starts showing up in `sessions.model` (e.g. a new tier
   or a renamed family). Verify presence with:

   ```sql
   SELECT model, COUNT(*) FROM sessions
   WHERE started_at > NOW() - INTERVAL '14 days'
   GROUP BY model ORDER BY 2 DESC;
   ```

   If a row's `model` does not match any non-`*` pattern, the cost figure is
   silently using Sonnet-4 fallback rates.
3. We retire a model family (delete the row in a follow-up migration; the
   `*` fallback continues to absorb stragglers).

This is **forward-only** — historical `estimated_cost_usd` values are not
recomputed. The recompute would require replaying every `response.complete`
event with the new rates, which is out of scope for the current pricing path.

## How to update

1. Create a new migration `NNN_token_pricing_<short-reason>.sql` (next
   sequential number; alphabetical ordering matters because
   `initializeDatabase` runs migrations in directory-sort order).
2. For each affected row, write an `INSERT … ON CONFLICT (id) DO UPDATE SET …`
   so the migration is idempotent and applies cleanly to a fresh DB and to a
   production DB that already has the prior seed.
3. **Before merge, if rates changed materially:** post the diff to the COO
   ([@COO](agent://6dee2da1-a096-4989-b450-4c6da06925b2)) on the PR for
   acknowledgment. Cost numbers are demoed to pilots, so cost-affecting
   changes need a second pair of eyes. Skip the COO ping only when the
   migration is structural and rates are unchanged.
4. Add a one-line comment block at the top of the migration naming the
   reason (e.g. _"Anthropic 2026-08-01 Sonnet-4 input price 3.0 → 3.5"_) and
   the source URL or screenshot path you verified the rate against.

## How to verify

After applying the migration locally:

```bash
# 1. Confirm rows updated as expected.
psql "$DATABASE_URL" -c "SELECT id, model_pattern, input_price_per_mtok, output_price_per_mtok FROM token_pricing ORDER BY id;"

# 2. Run the backend pricing test (gated on TEST_DATABASE_URL — see
#    packages/backend/src/db/__tests__/tokenPricing.test.ts for the matrix).
cd packages/backend
TEST_DATABASE_URL=postgres://devscope:devscope@localhost:5432/devscope_test \
  bun test src/db/__tests__/tokenPricing.test.ts
```

The test asserts that:

- A session with `model = 'claude-sonnet-4-20250514'` picks the `sonnet-4`
  row.
- A session with `model = 'claude-opus-4-6'` picks the `opus-4` row.
- A session with an unknown or NULL `model` falls back to the `*` row.

If you bumped a rate, also spot-check one production session by hand:

```sql
SELECT id, model, total_input_tokens, total_output_tokens,
       total_cache_creation_tokens, total_cache_read_tokens,
       estimated_cost_usd
FROM sessions
WHERE total_input_tokens > 0
ORDER BY started_at DESC LIMIT 5;
```

Then confirm the `estimated_cost_usd` matches what you'd compute from the new
rates. New cost values only land on the next `response.complete` /
`session.end` event for that session — old sessions keep their old figure.
