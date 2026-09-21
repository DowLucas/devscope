-- Session intent classification (for Contribution Pillars feature).
-- Populated by the sessionIntentClassification job using Gemini.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_intent TEXT;

ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_intent_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_intent_check
  CHECK (session_intent IS NULL OR session_intent IN
    ('debug','build','refactor','doc','review','exploration','tooling','other'));

CREATE INDEX IF NOT EXISTS idx_sessions_intent
  ON sessions (session_intent) WHERE session_intent IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_intent_started
  ON sessions (started_at, session_intent);
