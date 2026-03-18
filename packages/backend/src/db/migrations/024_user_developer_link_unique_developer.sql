-- Enforce single-owner semantics: each developer can only be linked to one user.
-- The composite PK (auth_user_id, developer_id) allows many-to-many, but business
-- logic requires one developer → one user. This adds a UNIQUE constraint on
-- developer_id so INSERT ... ON CONFLICT (developer_id) works atomically.

ALTER TABLE user_developer_link
  ADD CONSTRAINT uq_user_developer_link_developer_id UNIQUE (developer_id);
