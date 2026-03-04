-- Tooling health snapshots for trend detection
CREATE TABLE IF NOT EXISTS tooling_health_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  organization_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  project_name TEXT,
  snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE,
  total_calls INTEGER NOT NULL DEFAULT 0,
  failure_count INTEGER NOT NULL DEFAULT 0,
  failure_rate NUMERIC(5,2) NOT NULL DEFAULT 0,
  avg_duration_ms INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_health_snapshot_unique
  ON tooling_health_snapshots(organization_id, snapshot_date, tool_name, COALESCE(project_name, '__all__'));
