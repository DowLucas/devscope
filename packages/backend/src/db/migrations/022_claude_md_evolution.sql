CREATE TABLE IF NOT EXISTS claude_md_snapshots (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  project_name TEXT NOT NULL,
  project_path TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  content_size INTEGER NOT NULL,
  content_text TEXT,
  session_id TEXT NOT NULL,
  developer_id TEXT NOT NULL,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claude_md_project ON claude_md_snapshots(project_path, captured_at);
CREATE INDEX IF NOT EXISTS idx_claude_md_org ON claude_md_snapshots(organization_id, project_path);
CREATE UNIQUE INDEX IF NOT EXISTS idx_claude_md_hash_project ON claude_md_snapshots(project_path, content_hash);

CREATE TABLE IF NOT EXISTS claude_md_correlations (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  project_path TEXT NOT NULL,
  snapshot_id TEXT NOT NULL REFERENCES claude_md_snapshots(id),
  window_start TIMESTAMPTZ NOT NULL,
  window_end TIMESTAMPTZ NOT NULL,
  sessions_count INTEGER NOT NULL DEFAULT 0,
  avg_failure_rate NUMERIC,
  avg_prompt_count NUMERIC,
  avg_session_duration_min NUMERIC,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claude_md_corr_project ON claude_md_correlations(project_path, window_start);
