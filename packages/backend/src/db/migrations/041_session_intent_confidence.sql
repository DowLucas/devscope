-- Confidence for the session intent classification (TypeSafe System One).
--
-- The classifier returns a calibrated confidence alongside the chosen bucket.
-- Storing it keeps the two distinguishable downstream: a session classified
-- "other" with high confidence genuinely is miscellaneous, while one with low
-- confidence is simply ambiguous and should be excluded from intent rollups
-- rather than counted as "other".
--
-- NULL means the row was classified before confidence was recorded, or by a
-- fallback path that does not report one.
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS session_intent_confidence REAL;

CREATE INDEX IF NOT EXISTS idx_sessions_intent_confidence
  ON sessions (session_intent, session_intent_confidence)
  WHERE session_intent IS NOT NULL;
