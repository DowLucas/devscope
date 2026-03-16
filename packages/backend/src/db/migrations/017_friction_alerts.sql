-- Friction detection rules (per-org, with defaults)
CREATE TABLE IF NOT EXISTS friction_rules (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  rule_name TEXT NOT NULL,
  rule_type TEXT NOT NULL,
  config JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Friction alerts triggered during active sessions
CREATE TABLE IF NOT EXISTS friction_alerts (
  id TEXT PRIMARY KEY,
  organization_id TEXT,
  session_id TEXT NOT NULL,
  developer_id TEXT NOT NULL,
  rule_id TEXT REFERENCES friction_rules(id),
  rule_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  data_context JSONB DEFAULT '{}',
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  triggered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_fa_session ON friction_alerts(session_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_fa_org ON friction_alerts(organization_id, triggered_at DESC);
CREATE INDEX IF NOT EXISTS idx_fa_unack ON friction_alerts(organization_id, acknowledged, triggered_at DESC);
