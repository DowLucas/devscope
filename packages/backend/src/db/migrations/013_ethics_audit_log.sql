-- Ethics audit log: records when ethical guardrails activate
CREATE TABLE IF NOT EXISTS ethics_audit_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  organization_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'sensitive_fields_stripped',
    'ai_individual_reference_blocked',
    'privacy_mode_activated',
    'data_request_processed',
    'retention_purge_executed'
  )),
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ethics_audit_org_date
  ON ethics_audit_log(organization_id, created_at DESC);
