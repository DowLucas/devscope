-- Finds sessions the token estimator still has to replace. Index-only, so
-- the migration runner defers it until after the server is up.
CREATE INDEX IF NOT EXISTS idx_sessions_token_source_legacy
  ON sessions (ended_at) WHERE token_source = 'legacy';
