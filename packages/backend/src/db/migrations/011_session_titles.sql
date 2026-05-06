CREATE TABLE IF NOT EXISTS session_titles (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  title TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_session_titles_session ON session_titles(session_id);
CREATE INDEX IF NOT EXISTS idx_session_titles_generated ON session_titles(generated_at);

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS current_title TEXT;
