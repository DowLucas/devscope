-- Developer privacy preferences for opt-in detailed data sharing
-- Developers must opt in to share prompt text and tool inputs.
-- When share_details = true, their detailed data is stored and visible
-- only to themselves in the "My Patterns" self-service view.
-- Team members see only aggregate data (prompt count, tool name + success/fail).

ALTER TABLE developers
  ADD COLUMN IF NOT EXISTS share_details BOOLEAN NOT NULL DEFAULT FALSE;

-- Track when the preference was last changed
ALTER TABLE developers
  ADD COLUMN IF NOT EXISTS share_details_updated_at TIMESTAMPTZ;
