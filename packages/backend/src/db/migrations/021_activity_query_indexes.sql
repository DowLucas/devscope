-- Composite index for activity-over-time queries that JOIN events→sessions
-- and filter by created_at. Covers the (session_id, created_at) lookup pattern.
CREATE INDEX IF NOT EXISTS idx_events_session_created
  ON events(session_id, created_at);

-- Covering index for sessions filtered by developer_id (used in JOIN)
CREATE INDEX IF NOT EXISTS idx_sessions_developer_id
  ON sessions(developer_id, id);

-- Index for project-scoped activity queries
CREATE INDEX IF NOT EXISTS idx_sessions_project_developer
  ON sessions(project_name, developer_id, id);
