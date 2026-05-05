-- Session-level token tracking: cumulative totals across all compaction segments
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS total_input_tokens BIGINT DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS total_output_tokens BIGINT DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS total_cache_creation_tokens BIGINT DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS total_cache_read_tokens BIGINT DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS estimated_cost_usd NUMERIC(10,6) DEFAULT 0;

-- Per-segment peak tracking: high-water marks within current compaction segment.
-- Reset to 0 on compact.complete so the next segment accumulates independently.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS segment_peak_input BIGINT DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS segment_peak_output BIGINT DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS segment_peak_cache_creation BIGINT DEFAULT 0;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS segment_peak_cache_read BIGINT DEFAULT 0;

-- Configurable pricing table (model-pattern matched, backend-side cost calculation)
CREATE TABLE IF NOT EXISTS token_pricing (
  id TEXT PRIMARY KEY,
  model_pattern TEXT NOT NULL,
  input_price_per_mtok NUMERIC(10,4) NOT NULL,
  output_price_per_mtok NUMERIC(10,4) NOT NULL,
  cache_creation_price_per_mtok NUMERIC(10,4) NOT NULL,
  cache_read_price_per_mtok NUMERIC(10,4) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed default pricing (Claude Sonnet 4 rates as of March 2026)
INSERT INTO token_pricing (id, model_pattern, input_price_per_mtok, output_price_per_mtok, cache_creation_price_per_mtok, cache_read_price_per_mtok)
VALUES ('default', '*', 3.0, 15.0, 3.75, 0.30)
ON CONFLICT (id) DO NOTHING;

-- Index for token analytics queries
CREATE INDEX IF NOT EXISTS idx_sessions_token_cost ON sessions(estimated_cost_usd) WHERE estimated_cost_usd > 0;
