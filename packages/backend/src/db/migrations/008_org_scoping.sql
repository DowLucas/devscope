-- Migration 007: Add organization/user scoping columns for multi-tenant isolation

ALTER TABLE alert_rules ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE alert_events ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE digests ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE ai_conversations ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE ai_insights ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE ai_reports ADD COLUMN IF NOT EXISTS user_id TEXT;
ALTER TABLE ai_token_usage ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- Indexes for efficient org-scoped queries
CREATE INDEX IF NOT EXISTS idx_alert_rules_org ON alert_rules(organization_id);
CREATE INDEX IF NOT EXISTS idx_alert_events_org ON alert_events(organization_id);
CREATE INDEX IF NOT EXISTS idx_digests_org ON digests(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_org ON ai_conversations(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON ai_conversations(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_insights_org ON ai_insights(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_reports_org ON ai_reports(organization_id);
CREATE INDEX IF NOT EXISTS idx_ai_token_usage_org ON ai_token_usage(organization_id);
