-- "Share my sessions with my team" (developers.share_details) used to mean
-- "keep my details in my own views" and promised they were never shared with
-- teammates. It now shares sessions with the whole org, so opt-ins given under
-- the old wording must not carry over.
--
-- team_sharing_consented_at records an opt-in under the new wording. Migrations
-- re-run on every boot, so the reset only touches opt-ins without it and is a
-- no-op once everyone has re-consented.

ALTER TABLE developers
  ADD COLUMN IF NOT EXISTS team_sharing_consented_at TIMESTAMPTZ;

UPDATE developers
SET share_details = FALSE
WHERE share_details = TRUE
  AND team_sharing_consented_at IS NULL;
