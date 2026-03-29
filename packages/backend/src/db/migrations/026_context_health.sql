-- Context health metrics: track peak context usage from compaction events
-- peak_context_tokens stores the highest tokensBefore seen from compact.complete events
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS peak_context_tokens BIGINT NOT NULL DEFAULT 0;
