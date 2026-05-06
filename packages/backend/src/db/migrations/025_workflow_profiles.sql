CREATE TABLE IF NOT EXISTS workflow_profiles (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  developer_id TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  iterative_vs_planning NUMERIC,
  tool_diversity NUMERIC,
  recovery_speed NUMERIC,
  session_depth NUMERIC,
  prompt_density NUMERIC,
  agent_usage NUMERIC,
  raw_metrics JSONB DEFAULT '{}',
  sessions_analyzed INTEGER NOT NULL DEFAULT 0,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_wp_dev_period ON workflow_profiles(developer_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_wp_org ON workflow_profiles(organization_id, computed_at DESC);
