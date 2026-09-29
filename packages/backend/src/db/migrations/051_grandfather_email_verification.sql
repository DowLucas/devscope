-- Grandfather existing accounts into email verification.
--
-- emailAndPassword.requireEmailVerification is now on, which would block the next
-- password login of anyone who signed up before verification was required and
-- never clicked the link. Every account that exists when this migration first
-- runs is marked verified; accounts created afterwards must verify as normal.
-- (OAuth users are unaffected either way: their emailVerified comes from the
-- provider and the verification gate only applies to email/password sign-in.)
--
-- Migrations re-run on every boot, so the backfill is recorded in
-- schema_backfills and happens exactly once.

CREATE TABLE IF NOT EXISTS schema_backfills (
  name TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM schema_backfills WHERE name = 'grandfather_email_verification'
  ) THEN
    UPDATE auth_user SET "emailVerified" = TRUE, "updatedAt" = NOW()
    WHERE "emailVerified" = FALSE;
    INSERT INTO schema_backfills (name) VALUES ('grandfather_email_verification');
  END IF;
END $$;
