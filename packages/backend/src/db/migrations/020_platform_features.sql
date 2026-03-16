-- Feature 1: AI Tooling Maturity Index (Team-Level)
CREATE TABLE IF NOT EXISTS ai_maturity_snapshots (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  organization_id TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  overall_score NUMERIC(5,2),
  dimensions JSONB NOT NULL DEFAULT '{}',
  data_context JSONB NOT NULL DEFAULT '{}',
  narrative TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_maturity_org_date
  ON ai_maturity_snapshots (organization_id, snapshot_date DESC);

-- Feature 3: Anonymous Cross-Org Benchmarking
CREATE TABLE IF NOT EXISTS benchmark_contributions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  organization_id TEXT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}',
  contributed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(organization_id, period_start)
);

CREATE TABLE IF NOT EXISTS benchmark_percentiles (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  period_start DATE NOT NULL,
  metric_name TEXT NOT NULL,
  p25 NUMERIC,
  p50 NUMERIC,
  p75 NUMERIC,
  p90 NUMERIC,
  sample_size INTEGER NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(period_start, metric_name)
);

-- Feature 4: Playbook Marketplace
CREATE TABLE IF NOT EXISTS marketplace_playbooks (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  source_playbook_id TEXT,
  source_org_id TEXT,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  tool_sequence TEXT[] NOT NULL DEFAULT '{}',
  when_to_use TEXT NOT NULL DEFAULT '',
  success_metrics JSONB NOT NULL DEFAULT '{}',
  category TEXT,
  tags TEXT[] DEFAULT '{}',
  adoption_count INTEGER NOT NULL DEFAULT 0,
  avg_rating NUMERIC(3,2),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'removed')),
  published_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_marketplace_status
  ON marketplace_playbooks (status) WHERE status = 'published';

CREATE TABLE IF NOT EXISTS marketplace_adoptions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  marketplace_playbook_id TEXT NOT NULL REFERENCES marketplace_playbooks(id),
  adopting_org_id TEXT NOT NULL,
  adopted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  UNIQUE(marketplace_playbook_id, adopting_org_id)
);

-- Feature 5: Predictive Session Health
CREATE TABLE IF NOT EXISTS session_health_scores (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  session_id TEXT NOT NULL,
  score NUMERIC(5,2) NOT NULL,
  risk_factors JSONB NOT NULL DEFAULT '{}',
  suggested_playbook_id TEXT,
  suggested_skill_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_health_session
  ON session_health_scores (session_id, created_at DESC);

-- Organization settings extensions for benchmark opt-in and auto executive reports
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS benchmark_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_executive_report BOOLEAN NOT NULL DEFAULT FALSE;
