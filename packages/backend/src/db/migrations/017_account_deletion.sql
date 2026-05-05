-- Soft-delete flag for account deletion requests.
-- Accounts marked here are logged out immediately and will be purged by a
-- scheduled cleanup job (or a future hard-delete migration).
ALTER TABLE auth_user
  ADD COLUMN IF NOT EXISTS marked_for_deletion_at TIMESTAMPTZ DEFAULT NULL;
