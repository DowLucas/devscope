-- Add acceptedTerms column to auth_user for compliance tracking
DO $$ BEGIN
  ALTER TABLE auth_user ADD COLUMN "acceptedTerms" BOOLEAN NOT NULL DEFAULT FALSE;
EXCEPTION
  WHEN duplicate_column THEN NULL;
END $$;
