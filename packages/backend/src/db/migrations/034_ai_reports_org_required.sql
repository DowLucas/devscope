-- DEV-43: Make ai_reports.organization_id required + add weekly-cron dedup index.
--
-- Foundation for #14 Weekly Team Report (per the DEV-37 plan, child of DEV-39).
-- Migration 008 added organization_id as nullable; the weekly cron child (DEV-46)
-- needs (a) a guarantee every report is tenant-scoped and (b) a dedup constraint
-- so the cron can use ON CONFLICT DO NOTHING.
--
-- Steps (each idempotent so re-running on steady-state is a no-op):
--   1. Backfill organization_id for any pre-008 rows from the user_id <-> member
--      mapping. We pick the user's lowest-id membership deterministically; users
--      with multiple orgs are extremely rare in practice (early dev/test data).
--   2. Hard-delete rows still missing org binding -- no safe attribution path.
--   3. ALTER COLUMN ... SET NOT NULL (idempotent on already-NOT-NULL columns).
--   4. Partial UNIQUE index on (organization_id, report_type, period_start)
--      restricted to weekly + non-null period_start. Doubles as the cron lookup
--      index; existing daily/session/custom rows are unaffected.

-- 1. Backfill from member table (Better Auth uses camelCase columns).
UPDATE ai_reports r
SET organization_id = m."organizationId"
FROM member m
WHERE r.organization_id IS NULL
  AND r.user_id IS NOT NULL
  AND m."userId" = r.user_id
  AND m."organizationId" = (
    SELECT MIN(m2."organizationId")
    FROM member m2
    WHERE m2."userId" = r.user_id
  );

-- 2. Orphans -- predate org-scoping and have no user_id either. Cannot be
--    attributed to any tenant; safest to drop. Pilot prod has zero in steady
--    state; dry-run on a pg_dump restore should confirm before promoting.
DELETE FROM ai_reports WHERE organization_id IS NULL;

-- 3. Enforce NOT NULL.
ALTER TABLE ai_reports ALTER COLUMN organization_id SET NOT NULL;

-- 4. Weekly-cron dedup + lookup. Partial unique so it does not collide with
--    existing rows of other report_types and tolerates legacy rows without
--    period_start.
CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_reports_weekly_dedup
  ON ai_reports (organization_id, report_type, period_start)
  WHERE report_type = 'weekly' AND period_start IS NOT NULL;
