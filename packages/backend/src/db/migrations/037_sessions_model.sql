-- DEV-93: Persist Claude Code model id on the session row.
--
-- Claude Code's SessionStart hook input includes the active model
-- (e.g. `claude-sonnet-4-20250514`). The plugin already extracts this
-- and ships it on the session.start payload. We capture it on the
-- sessions row at first INSERT so the dashboard / analytics can reason
-- about model distribution per session.
--
-- Aggregate-only signal: per-session, never used for individual
-- ranking (mission / leaderboard guardrail).

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS model TEXT;
