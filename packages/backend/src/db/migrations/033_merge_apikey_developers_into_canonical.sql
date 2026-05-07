-- DEV-24: collapse the legacy `apikey-<authUserId>` developer namespace into
-- the canonical SHA256(email) namespace produced by the plugin and (post
-- DEV-24) by `/api/events/hook`.
--
-- Highest-risk piece of Bet A — must be reviewed against a staging-data
-- dump before running in prod (per DEV-11 constraint).
--
-- Idempotent: when there are no `apikey-%` rows left in `developers`, the
-- DO block iterates zero times and the migration is a no-op. Safe to
-- re-run.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
DECLARE
  rec RECORD;
  canonical_id TEXT;
  canonical_email TEXT;
  canonical_name TEXT;
  apikey_count INT := 0;
  merged_count INT := 0;
  skipped_count INT := 0;
BEGIN
  -- Snapshot the work set up front so concurrent inserts during the migration
  -- (extremely unlikely on staging/prod since this runs at process start) do
  -- not cause us to chase a moving target.
  CREATE TEMP TABLE _dev24_pending ON COMMIT DROP AS
    SELECT id AS old_dev_id,
           SUBSTRING(id FROM 8) AS auth_user_id  -- strip 'apikey-' (7 chars)
    FROM developers
    WHERE id LIKE 'apikey-%';

  SELECT COUNT(*) INTO apikey_count FROM _dev24_pending;
  IF apikey_count = 0 THEN
    RAISE NOTICE '[028] no apikey-* developer rows — nothing to do';
    RETURN;
  END IF;

  RAISE NOTICE '[028] merging % apikey-* developer rows into SHA256(email) canonical rows', apikey_count;

  FOR rec IN SELECT * FROM _dev24_pending LOOP
    SELECT email, name INTO canonical_email, canonical_name
    FROM auth_user
    WHERE id = rec.auth_user_id;

    IF canonical_email IS NULL OR canonical_email = '' THEN
      -- The auth_user is gone (account deletion) and we cannot derive a
      -- canonical id. Leave the row so historical events still attribute
      -- somewhere; a follow-up cleanup can decide whether to soft-delete.
      RAISE NOTICE '[028] skip %: no auth_user.email found for %', rec.old_dev_id, rec.auth_user_id;
      skipped_count := skipped_count + 1;
      CONTINUE;
    END IF;

    canonical_id := encode(digest(lower(btrim(canonical_email)), 'sha256'), 'hex');

    -- Ensure the canonical developers row exists. Preserve the earliest
    -- first_seen (the apikey row may pre-date the plugin row) so historical
    -- timelines stay correct.
    INSERT INTO developers (id, name, email, first_seen, last_seen)
    SELECT canonical_id,
           COALESCE(NULLIF(canonical_name, ''), 'Developer'),
           canonical_email,
           d.first_seen,
           d.last_seen
    FROM developers d
    WHERE d.id = rec.old_dev_id
    ON CONFLICT (id) DO UPDATE SET
      first_seen = LEAST(developers.first_seen, EXCLUDED.first_seen),
      last_seen  = GREATEST(developers.last_seen, EXCLUDED.last_seen),
      email      = CASE WHEN developers.email = '' OR developers.email IS NULL
                        THEN EXCLUDED.email ELSE developers.email END,
      name       = CASE WHEN developers.name = '' OR developers.name = 'API Key User' OR developers.name IS NULL
                        THEN EXCLUDED.name ELSE developers.name END;

    -- Repoint sessions (FK NO ACTION — must move before we delete the apikey row).
    UPDATE sessions
       SET developer_id = canonical_id
     WHERE developer_id = rec.old_dev_id;

    -- Repoint denormalized developer_id columns (no FK; preserve attribution).
    UPDATE alert_events         SET developer_id = canonical_id WHERE developer_id = rec.old_dev_id;
    UPDATE friction_alerts      SET developer_id = canonical_id WHERE developer_id = rec.old_dev_id;
    UPDATE claude_md_snapshots  SET developer_id = canonical_id WHERE developer_id = rec.old_dev_id;
    UPDATE privacy_requests     SET developer_id = canonical_id WHERE developer_id = rec.old_dev_id;

    -- workflow_profiles has UNIQUE(developer_id, period_start, period_end).
    -- If the canonical row already has a profile for the same period (very
    -- rare in practice but possible for users who used both pathways in the
    -- same week), keep the canonical one and drop the apikey one.
    UPDATE workflow_profiles wp_old
       SET developer_id = canonical_id
     WHERE wp_old.developer_id = rec.old_dev_id
       AND NOT EXISTS (
         SELECT 1 FROM workflow_profiles wp_new
          WHERE wp_new.developer_id = canonical_id
            AND wp_new.period_start  = wp_old.period_start
            AND wp_new.period_end    = wp_old.period_end
       );
    DELETE FROM workflow_profiles WHERE developer_id = rec.old_dev_id;

    -- organization_developer: PK (organization_id, developer_id). Carry over
    -- any org links and drop the apikey-keyed rows.
    INSERT INTO organization_developer (organization_id, developer_id)
    SELECT organization_id, canonical_id
      FROM organization_developer
     WHERE developer_id = rec.old_dev_id
    ON CONFLICT DO NOTHING;
    DELETE FROM organization_developer WHERE developer_id = rec.old_dev_id;

    -- user_developer_link: post-024 has UNIQUE(developer_id). Insert the
    -- canonical link if no other user already claims canonical_id; then
    -- drop the apikey-keyed row.
    INSERT INTO user_developer_link (auth_user_id, developer_id)
    VALUES (rec.auth_user_id, canonical_id)
    ON CONFLICT (developer_id) DO NOTHING;
    DELETE FROM user_developer_link WHERE developer_id = rec.old_dev_id;

    -- Finally, remove the now-orphan apikey developer row.
    DELETE FROM developers WHERE id = rec.old_dev_id;
    merged_count := merged_count + 1;
  END LOOP;

  RAISE NOTICE '[028] merge complete: merged=%, skipped=%, total=%',
    merged_count, skipped_count, apikey_count;
END
$$;
