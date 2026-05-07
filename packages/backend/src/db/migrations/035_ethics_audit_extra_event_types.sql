-- DEV-45: Mission guardrail audit-log event types.
--
-- Extends the ethics_audit_log CHECK constraint with two values used by the
-- weekly-buyer report flow's mission guardrail:
--
--   * weekly_report_llm_input — happy-path log of every LLM input dispatched
--     from the weekly-buyer surface (full team-aggregated payload, persona,
--     period, organization_id, payload SHA-256). Lets a CEO/COO query a
--     pilot week and prove zero leaks post-hoc.
--   * mission_violation — runtime tripwire fired BEFORE the LLM call when a
--     developer-identifying string is detected in the payload. Also pulls
--     v1 per the DEV-37 kill criteria.
--
-- The original 013 migration created the constraint with a fixed list; we
-- have to drop and recreate it (Postgres has no ALTER for CHECK constraint
-- expressions). This is purely additive — existing rows are unaffected.

ALTER TABLE ethics_audit_log DROP CONSTRAINT IF EXISTS ethics_audit_log_event_type_check;

ALTER TABLE ethics_audit_log ADD CONSTRAINT ethics_audit_log_event_type_check
  CHECK (event_type IN (
    'sensitive_fields_stripped',
    'ai_individual_reference_blocked',
    'privacy_mode_activated',
    'data_request_processed',
    'retention_purge_executed',
    'weekly_report_llm_input',
    'mission_violation'
  ));
