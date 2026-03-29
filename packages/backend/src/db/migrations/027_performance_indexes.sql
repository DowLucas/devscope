-- Performance indexes for metrics page queries
-- These queries filter sessions by started_at and events by created_at + session_id,
-- causing full table scans without proper indexes.

-- Sessions: period comparison, token usage, burn rate all filter by started_at
CREATE INDEX IF NOT EXISTS idx_sessions_started_at_developer
  ON sessions (started_at DESC, developer_id);

-- Events: activity over time queries range-scan created_at then join on session_id
CREATE INDEX IF NOT EXISTS idx_events_created_session
  ON events (created_at DESC, session_id);
