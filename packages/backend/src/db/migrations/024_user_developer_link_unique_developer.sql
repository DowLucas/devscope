-- Enforce single-owner semantics: each developer can only be linked to one user.
-- The composite PK (auth_user_id, developer_id) allows many-to-many, but business
-- logic requires one developer → one user. This adds a UNIQUE constraint on
-- developer_id so INSERT ... ON CONFLICT (developer_id) works atomically.

-- First, deterministically remove duplicate developer_id rows, keeping only the
-- earliest-linked auth_user_id (smallest auth_user_id as tiebreaker) per developer.
DELETE FROM user_developer_link
WHERE ctid NOT IN (
  SELECT DISTINCT ON (developer_id) ctid
  FROM user_developer_link
  ORDER BY developer_id, auth_user_id
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_user_developer_link_developer_id'
  ) THEN
    ALTER TABLE user_developer_link
      ADD CONSTRAINT uq_user_developer_link_developer_id UNIQUE (developer_id);
  END IF;
END
$$;
