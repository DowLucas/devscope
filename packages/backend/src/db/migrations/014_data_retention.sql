-- Data retention settings per organization
ALTER TABLE organization_settings
  ADD COLUMN IF NOT EXISTS retention_days INTEGER NOT NULL DEFAULT 90
    CHECK (retention_days >= 30 AND retention_days <= 365),
  ADD COLUMN IF NOT EXISTS anonymize_on_expire BOOLEAN NOT NULL DEFAULT TRUE;

-- Seed an anonymized developer record used as the target for anonymization
INSERT INTO developers (id, name, email, first_seen, last_seen)
VALUES ('anonymized', 'Anonymized', 'anonymized@devscope.local', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;

-- Log of retention purge runs
CREATE TABLE IF NOT EXISTS retention_log (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
  organization_id TEXT NOT NULL,
  purged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  events_deleted INTEGER NOT NULL DEFAULT 0,
  sessions_anonymized INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_retention_log_org
  ON retention_log(organization_id, purged_at DESC);
