-- Index for skill usage queries: only indexes Skill tool events
CREATE INDEX IF NOT EXISTS idx_events_skill_name
  ON events ((payload->'toolInput'->>'skill'))
  WHERE payload->>'toolName' = 'Skill';
