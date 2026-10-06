-- Token accounting v2: exact per-model usage summed from Claude Code transcripts.
--
-- Until plugin 0.23.0 the plugin sent the usage of only the LAST API call in
-- the transcript, and updateSessionTokens kept the maximum per compaction
-- segment, treating it as a running total. A session's stored usage was
-- therefore roughly one API call: measured against 24 transcripts on
-- 2026-10-06, stored cost was ~41x below the real API-equivalent cost.
--
-- New model:
--   session_token_usage  one row per (session, transcript, model). A DevScope
--                        session spans several Claude Code transcripts across
--                        /clear, resume and compact, and a transcript can use
--                        several models (subagents, /model).
--     source 'exact'     totals summed from the transcript by the plugin
--                        (usageSnapshot on response.complete / session.end),
--                        or uploaded by /devscope:backfill-usage
--     source 'estimated' reconstructed server-side from the per-turn
--                        tokenUsage on response.complete events plus tool
--                        counts (db/tokenUsageQueries.ts). Totals land within
--                        a few percent; single sessions can be off ~2x.
--   sessions.total_* / estimated_cost_usd stay as the rolled-up figures so
--   existing queries keep working; sessions.token_source says where they
--   came from: 'exact' | 'estimated' | 'legacy' (the old undercount, still
--   written by pre-0.23.0 plugins until the estimator replaces it).
--
-- Costs are API-equivalent list prices, not what a subscription plan pays.

CREATE TABLE IF NOT EXISTS session_token_usage (
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  -- Claude Code session id of the transcript; '' for a server-side estimate.
  transcript_id TEXT NOT NULL,
  -- Model id as reported by the API; '' when unknown.
  model TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('exact', 'estimated')),
  input_tokens BIGINT NOT NULL DEFAULT 0,
  output_tokens BIGINT NOT NULL DEFAULT 0,
  cache_write_5m_tokens BIGINT NOT NULL DEFAULT 0,
  cache_write_1h_tokens BIGINT NOT NULL DEFAULT 0,
  cache_read_tokens BIGINT NOT NULL DEFAULT 0,
  api_calls INT NOT NULL DEFAULT 0,
  cost_usd NUMERIC(14,6) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, transcript_id, model)
);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS token_source TEXT;

-- A long Opus session can exceed $9,999.99 at list prices.
DO $migration$
BEGIN
  IF (SELECT numeric_precision FROM information_schema.columns
      WHERE table_name = 'sessions' AND column_name = 'estimated_cost_usd') < 14 THEN
    ALTER TABLE sessions ALTER COLUMN estimated_cost_usd TYPE NUMERIC(14,6);
  END IF;
END
$migration$;

-- Claude Code writes mostly 1-hour cache entries (2x input), not 5-minute
-- ones (1.25x, the existing cache_creation column).
ALTER TABLE token_pricing ADD COLUMN IF NOT EXISTS cache_write_1h_price_per_mtok NUMERIC(10,4);

-- Rates: Anthropic first-party list prices as of 2026-09-25, USD per million
-- tokens. Longest matching pattern wins; '*' is the fallback (see 038).
-- Model ids may carry a "[1m]" suffix from Claude Code; the trailing % covers it.
INSERT INTO token_pricing (id, model_pattern, input_price_per_mtok, output_price_per_mtok,
  cache_creation_price_per_mtok, cache_read_price_per_mtok, cache_write_1h_price_per_mtok)
VALUES
  ('fable-5-1',  'claude-fable-5-1%',  10.0, 50.0, 12.50, 0.25, 20.0),
  ('fable-5',    'claude-fable-5%',    10.0, 50.0, 12.50, 1.00, 20.0),
  ('mythos-5-1', 'claude-mythos-5-1%', 10.0, 50.0, 12.50, 0.25, 20.0),
  ('mythos-5',   'claude-mythos-5%',   10.0, 50.0, 12.50, 1.00, 20.0),
  ('opus-5-5',   'claude-opus-5-5%',    4.0, 20.0,  5.00, 0.20,  8.0),
  ('opus-5',     'claude-opus-5%',      5.0, 25.0,  6.25, 0.50, 10.0),
  ('opus-4-8',   'claude-opus-4-8%',    5.0, 25.0,  6.25, 0.50, 10.0),
  ('opus-4-7',   'claude-opus-4-7%',    5.0, 25.0,  6.25, 0.50, 10.0),
  ('opus-4-6',   'claude-opus-4-6%',    5.0, 25.0,  6.25, 0.50, 10.0),
  ('opus-4-5',   'claude-opus-4-5%',    5.0, 25.0,  6.25, 0.50, 10.0),
  -- Opus 4.0 / 4.1 keep the original Opus price.
  ('opus-4',     'claude-opus-4-%',    15.0, 75.0, 18.75, 1.50, 30.0),
  ('sonnet-5-5', 'claude-sonnet-5-5%',  2.0, 10.0,  2.50, 0.20,  4.0),
  ('sonnet-5',   'claude-sonnet-5%',    2.0, 10.0,  2.50, 0.20,  4.0),
  ('sonnet-4-6', 'claude-sonnet-4-6%',  3.0, 15.0,  3.75, 0.30,  6.0),
  ('sonnet-4',   'claude-sonnet-4-%',   3.0, 15.0,  3.75, 0.30,  6.0),
  -- 038 used 'claude-haiku-4-5-%', which misses the undated id.
  ('haiku-4-5',  'claude-haiku-4-5%',   1.0,  5.0,  1.25, 0.10,  2.0)
ON CONFLICT (id) DO UPDATE SET
  model_pattern = EXCLUDED.model_pattern,
  input_price_per_mtok = EXCLUDED.input_price_per_mtok,
  output_price_per_mtok = EXCLUDED.output_price_per_mtok,
  cache_creation_price_per_mtok = EXCLUDED.cache_creation_price_per_mtok,
  cache_read_price_per_mtok = EXCLUDED.cache_read_price_per_mtok,
  cache_write_1h_price_per_mtok = EXCLUDED.cache_write_1h_price_per_mtok;

UPDATE token_pricing SET cache_write_1h_price_per_mtok = input_price_per_mtok * 2
WHERE cache_write_1h_price_per_mtok IS NULL;

-- API-equivalent USD for one bucket of usage under `p_model`.
CREATE OR REPLACE FUNCTION token_cost_usd(
  p_model TEXT, p_input BIGINT, p_output BIGINT,
  p_write_5m BIGINT, p_write_1h BIGINT, p_read BIGINT
) RETURNS NUMERIC
LANGUAGE sql STABLE
AS $$
  SELECT (
    p_input    * p.input_price_per_mtok +
    p_output   * p.output_price_per_mtok +
    p_write_5m * p.cache_creation_price_per_mtok +
    p_write_1h * COALESCE(p.cache_write_1h_price_per_mtok, p.input_price_per_mtok * 2) +
    p_read     * p.cache_read_price_per_mtok
  ) / 1000000.0
  FROM (
    SELECT * FROM token_pricing
    WHERE (model_pattern <> '*' AND COALESCE(p_model, '') LIKE model_pattern) OR model_pattern = '*'
    ORDER BY (model_pattern = '*') ASC, length(model_pattern) DESC
    LIMIT 1
  ) p
$$;

-- Every row already stored was priced with the rates current at the time;
-- reprice on boot so a rate change here applies everywhere. Cheap: a few
-- rows per session.
UPDATE session_token_usage
SET cost_usd = token_cost_usd(model, input_tokens, output_tokens,
                              cache_write_5m_tokens, cache_write_1h_tokens, cache_read_tokens)
WHERE cost_usd IS DISTINCT FROM token_cost_usd(model, input_tokens, output_tokens,
                              cache_write_5m_tokens, cache_write_1h_tokens, cache_read_tokens);

UPDATE sessions s SET estimated_cost_usd = a.cost
FROM (
  SELECT u.session_id, SUM(u.cost_usd) AS cost
  FROM session_token_usage u
  JOIN sessions s2 ON s2.id = u.session_id
  WHERE u.source = 'exact' OR s2.token_source = 'estimated'
  GROUP BY u.session_id
) a
WHERE s.id = a.session_id
  AND s.token_source IN ('exact', 'estimated')
  AND s.estimated_cost_usd IS DISTINCT FROM a.cost;

-- Sessions carrying the pre-v2 undercount. The estimator (job for recent
-- sessions, scripts/token-backfill.ts for history) replaces these.
UPDATE sessions SET token_source = 'legacy'
WHERE token_source IS NULL
  AND (total_output_tokens > 0 OR total_cache_read_tokens > 0 OR total_input_tokens > 0);
