-- Performance indexes for metrics page queries
-- Non-blocking: IF NOT EXISTS makes these no-ops after first run

CREATE INDEX IF NOT EXISTS idx_sessions_started_at_developer
  ON sessions (started_at DESC, developer_id);

CREATE INDEX IF NOT EXISTS idx_events_created_session
  ON events (created_at DESC, session_id);
