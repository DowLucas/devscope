-- Tenant-scope patterns, anti-patterns and playbooks.
--
-- session_patterns / anti_patterns / playbooks (migration 009) had no owner: the
-- daily job mined every organization's sessions together, merged rows across
-- tenants by tool_sequence, and served the result (including file paths and
-- commands in data_context) to every org. Each row is now owned by one org.
--
-- Rows written before this migration are cross-tenant blends and cannot be
-- attributed to a single org, so they are deleted once and regenerated per org by
-- the next analysis run. The delete cascades to session_pattern_matches and
-- session_anti_pattern_matches; playbooks.source_pattern_id and
-- team_skill_pattern_links.pattern_id / anti_pattern_id are ON DELETE SET NULL,
-- so team_skills (already org-scoped) are kept and only lose their back-links.
--
-- Migrations re-run on every boot: the purge is guarded by the column not
-- existing yet, so it happens exactly once.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'session_patterns' AND column_name = 'organization_id'
  ) THEN
    DELETE FROM session_patterns;
    DELETE FROM anti_patterns;
    DELETE FROM playbooks;
    -- Orphan-proofing in case any link table lacks its cascade
    DELETE FROM session_pattern_matches;
    DELETE FROM session_anti_pattern_matches;
  END IF;
END $$;

ALTER TABLE session_patterns ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE anti_patterns ADD COLUMN IF NOT EXISTS organization_id TEXT;
ALTER TABLE playbooks ADD COLUMN IF NOT EXISTS organization_id TEXT;

-- Safe to be strict: the tables are empty after the purge above on first run,
-- and every writer sets organization_id from then on.
ALTER TABLE session_patterns ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE anti_patterns ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE playbooks ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_session_patterns_org ON session_patterns(organization_id, effectiveness);
CREATE INDEX IF NOT EXISTS idx_anti_patterns_org ON anti_patterns(organization_id, severity);
CREATE INDEX IF NOT EXISTS idx_playbooks_org ON playbooks(organization_id, status);
