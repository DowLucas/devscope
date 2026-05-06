CREATE TABLE IF NOT EXISTS team_tool_topology (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  total_uses INTEGER NOT NULL DEFAULT 0,
  unique_users INTEGER NOT NULL DEFAULT 0,
  success_count INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  failure_rate NUMERIC,
  avg_duration_ms NUMERIC,
  proficiency_level TEXT NOT NULL DEFAULT 'unknown',
  coverage_level TEXT NOT NULL DEFAULT 'unknown',
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ttt_org ON team_tool_topology(organization_id, computed_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_ttt_org_tool_period ON team_tool_topology(organization_id, tool_name, period_start, period_end);

CREATE TABLE IF NOT EXISTS team_skill_gaps (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  gap_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info',
  description TEXT NOT NULL,
  data_context JSONB DEFAULT '{}',
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tsg_org ON team_skill_gaps(organization_id, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_tsg_active ON team_skill_gaps(organization_id, resolved_at) WHERE resolved_at IS NULL;
