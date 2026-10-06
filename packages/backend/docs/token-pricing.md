# Updating token pricing

DevScope estimates per-session API cost in USD from token counts emitted by the
plugin and a static pricing table. This runbook covers where the pricing lives,
when to refresh it, and how to verify a change.

## Where the seed lives

- Schema: migration `030_session_token_usage.sql` defines the `token_pricing`
  table and the original wildcard seed row.
- Active rates: migration `055_token_usage_v2.sql` upserts a row per current
  model (Fable 5/5.1, Opus 4.0-5.5, Sonnet 4-5.5, Haiku 4.5) on top of 038's
  rows and the `*` fallback, and adds the 1-hour cache-write price. 038 and
  055 both re-run on every boot and 055 runs later, so its values win. **Each
  future rate change adds a new migration that upserts the affected rows.** Do
  not edit a previously-shipped migration after it has been applied.
- Read path: the SQL function `token_cost_usd(model, input, output, write_5m,
  write_1h, read)` (055) matches the model against `token_pricing.model_pattern`
  via SQL LIKE and picks the longest matching non-`*` row, falling back to `*`.
  Usage is priced per model in `session_token_usage` and summed onto the session
  (`db/tokenUsageQueries.ts`). The legacy `updateSessionTokens` path for
  plugins before 0.23.0 uses the same matching rule inline.
- Costs are **API-equivalent list prices**: what the tokens would cost on the
  API, not what a Claude subscription plan charges.

The columns are:

| Column                          | Meaning                                  |
| ------------------------------- | ---------------------------------------- |
| `id`                            | Stable row id used by the upsert         |
| `model_pattern`                 | SQL LIKE pattern (e.g. `claude-opus-4-%`) — or the literal `*` for the fallback row |
| `input_price_per_mtok`          | USD per million input tokens             |
| `output_price_per_mtok`         | USD per million output tokens            |
| `cache_creation_price_per_mtok` | USD per million 5-minute cache writes (1.25x input) |
| `cache_write_1h_price_per_mtok` | USD per million 1-hour cache writes (2x input); Claude Code writes mostly these |
| `cache_read_price_per_mtok`     | USD per million cache-read tokens (model-specific: 0.1x input on most, $0.20 on Opus 5.5, $0.25 on Fable 5.1) |

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

Rate changes apply to history: 055 reprices every `session_token_usage` row
and re-sums the affected sessions on boot. Only sessions still on the legacy
path (`token_source = 'legacy'`) keep the figure they were written with until
the token estimator replaces them.

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
- Opus 4.0 (`claude-opus-4-20250514`) picks the `opus-4` row ($15) while
  `claude-opus-4-6` picks its own ($5).
- Claude Code's `[1m]` suffix still matches (`claude-opus-5-5[1m]`), and the
  undated `claude-haiku-4-5` id matches `haiku-4-5`.
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
rates. Sessions with exact or estimated usage are repriced on the next boot.
