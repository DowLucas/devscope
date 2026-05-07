-- DEV-76: Per-session salt-version stamp for plugin-side path/pattern hashing.
--
-- Sets up the backend half of the Option-1 wire fix sanctioned on DEV-72.
-- The plugin (DEV-74) will hash file_path/pattern/path values at emit time
-- using an org-scoped salt distributed via session.start. We stamp the
-- salt_version on the session row so a future rotation can disambiguate
-- which key was in force when the row was written.
--
-- The salt itself is NEVER persisted — only the version. See
-- packages/backend/src/utils/orgSalt.ts for derivation.

ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS salt_version SMALLINT NOT NULL DEFAULT 1;
