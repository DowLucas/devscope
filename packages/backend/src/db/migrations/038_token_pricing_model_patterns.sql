-- DEV-99: Refresh token_pricing seed with model-tier rows so updateSessionTokens
-- can pick the right rates per session. Migration 030 left a single wildcard
-- '*' row using Sonnet-4 rates, and queries.ts joined on p.id = 'default', so
-- every session got Sonnet-4 pricing regardless of its actual model. This
-- migration seeds explicit rows per Claude Code model family and keeps the
-- '*' row as the fallback when sessions.model is NULL or unrecognized.
--
-- The matching rule (in queries.ts/updateSessionTokens) is: prefer the
-- longest non-'*' model_pattern that matches sessions.model via SQL LIKE,
-- falling back to the '*' row. So '*' MUST stay; remove specific rows
-- via a follow-up migration if a tier is retired.
--
-- Rates source: Anthropic public pricing as of 2026-05-08 (USD per million
-- tokens — input / output / cache_create / cache_read). Sonnet-4 rates
-- are unchanged from the March 2026 seed, so no historical recompute is
-- needed and no COO pricing review is required for this migration.
--
-- Runbook for keeping these rates current:
--   packages/backend/docs/token-pricing.md

-- Sonnet-4 family — claude-sonnet-4-*, claude-sonnet-4-5-*, claude-sonnet-4-6-*
INSERT INTO token_pricing (id, model_pattern, input_price_per_mtok, output_price_per_mtok, cache_creation_price_per_mtok, cache_read_price_per_mtok)
VALUES ('sonnet-4', 'claude-sonnet-4-%', 3.0, 15.0, 3.75, 0.30)
ON CONFLICT (id) DO UPDATE SET
  model_pattern = EXCLUDED.model_pattern,
  input_price_per_mtok = EXCLUDED.input_price_per_mtok,
  output_price_per_mtok = EXCLUDED.output_price_per_mtok,
  cache_creation_price_per_mtok = EXCLUDED.cache_creation_price_per_mtok,
  cache_read_price_per_mtok = EXCLUDED.cache_read_price_per_mtok;

-- Opus-4 family — claude-opus-4-*, claude-opus-4-5-*, claude-opus-4-6-*
INSERT INTO token_pricing (id, model_pattern, input_price_per_mtok, output_price_per_mtok, cache_creation_price_per_mtok, cache_read_price_per_mtok)
VALUES ('opus-4', 'claude-opus-4-%', 15.0, 75.0, 18.75, 1.50)
ON CONFLICT (id) DO UPDATE SET
  model_pattern = EXCLUDED.model_pattern,
  input_price_per_mtok = EXCLUDED.input_price_per_mtok,
  output_price_per_mtok = EXCLUDED.output_price_per_mtok,
  cache_creation_price_per_mtok = EXCLUDED.cache_creation_price_per_mtok,
  cache_read_price_per_mtok = EXCLUDED.cache_read_price_per_mtok;

-- Haiku-4.5 family — claude-haiku-4-5-*
INSERT INTO token_pricing (id, model_pattern, input_price_per_mtok, output_price_per_mtok, cache_creation_price_per_mtok, cache_read_price_per_mtok)
VALUES ('haiku-4-5', 'claude-haiku-4-5-%', 1.0, 5.0, 1.25, 0.10)
ON CONFLICT (id) DO UPDATE SET
  model_pattern = EXCLUDED.model_pattern,
  input_price_per_mtok = EXCLUDED.input_price_per_mtok,
  output_price_per_mtok = EXCLUDED.output_price_per_mtok,
  cache_creation_price_per_mtok = EXCLUDED.cache_creation_price_per_mtok,
  cache_read_price_per_mtok = EXCLUDED.cache_read_price_per_mtok;

-- Haiku-3.5 family — claude-haiku-3-5-* (older, still seen on some sessions)
INSERT INTO token_pricing (id, model_pattern, input_price_per_mtok, output_price_per_mtok, cache_creation_price_per_mtok, cache_read_price_per_mtok)
VALUES ('haiku-3-5', 'claude-haiku-3-5-%', 0.80, 4.0, 1.0, 0.08)
ON CONFLICT (id) DO UPDATE SET
  model_pattern = EXCLUDED.model_pattern,
  input_price_per_mtok = EXCLUDED.input_price_per_mtok,
  output_price_per_mtok = EXCLUDED.output_price_per_mtok,
  cache_creation_price_per_mtok = EXCLUDED.cache_creation_price_per_mtok,
  cache_read_price_per_mtok = EXCLUDED.cache_read_price_per_mtok;

-- Wildcard fallback. Stays at Sonnet-4 rates because Sonnet-4 is the most
-- common model and a safe over-estimate beats a NULL cost. Keep this row.
INSERT INTO token_pricing (id, model_pattern, input_price_per_mtok, output_price_per_mtok, cache_creation_price_per_mtok, cache_read_price_per_mtok)
VALUES ('default', '*', 3.0, 15.0, 3.75, 0.30)
ON CONFLICT (id) DO UPDATE SET
  model_pattern = EXCLUDED.model_pattern,
  input_price_per_mtok = EXCLUDED.input_price_per_mtok,
  output_price_per_mtok = EXCLUDED.output_price_per_mtok,
  cache_creation_price_per_mtok = EXCLUDED.cache_creation_price_per_mtok,
  cache_read_price_per_mtok = EXCLUDED.cache_read_price_per_mtok;
