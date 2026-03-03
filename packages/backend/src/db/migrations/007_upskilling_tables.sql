-- Upskilling Platform tables: patterns, anti-patterns, playbooks
-- Migration 007

-- Extend ai_insights type check to include 'coaching'
ALTER TABLE ai_insights DROP CONSTRAINT IF EXISTS ai_insights_type_check;
ALTER TABLE ai_insights ADD CONSTRAINT ai_insights_type_check
  CHECK (type IN ('anomaly', 'trend', 'comparison', 'recommendation', 'coaching'));

-- Patterns discovered from session tool sequences
CREATE TABLE IF NOT EXISTS session_patterns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  tool_sequence TEXT[] NOT NULL,
  avg_success_rate FLOAT NOT NULL DEFAULT 0,
  occurrence_count INT NOT NULL DEFAULT 1,
  effectiveness TEXT NOT NULL DEFAULT 'neutral' CHECK (effectiveness IN ('effective', 'neutral', 'ineffective')),
  category TEXT,
  data_context JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Link table: which sessions exhibited which patterns
CREATE TABLE IF NOT EXISTS session_pattern_matches (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  pattern_id TEXT NOT NULL REFERENCES session_patterns(id) ON DELETE CASCADE,
  match_confidence FLOAT NOT NULL DEFAULT 1.0,
  tool_success_rate FLOAT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Anti-patterns detected in sessions
CREATE TABLE IF NOT EXISTS anti_patterns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  detection_rule TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  suggestion TEXT NOT NULL,
  occurrence_count INT NOT NULL DEFAULT 1,
  data_context JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Link: which sessions exhibited which anti-patterns
CREATE TABLE IF NOT EXISTS session_anti_pattern_matches (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  anti_pattern_id TEXT NOT NULL REFERENCES anti_patterns(id) ON DELETE CASCADE,
  details JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Team playbooks: shareable workflow patterns
CREATE TABLE IF NOT EXISTS playbooks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  tool_sequence TEXT[] NOT NULL,
  when_to_use TEXT NOT NULL,
  success_metrics JSONB NOT NULL DEFAULT '{}',
  source_pattern_id TEXT REFERENCES session_patterns(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'draft', 'archived')),
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_session_patterns_effectiveness ON session_patterns(effectiveness);
CREATE INDEX IF NOT EXISTS idx_session_patterns_created ON session_patterns(created_at);
CREATE INDEX IF NOT EXISTS idx_session_pattern_matches_session ON session_pattern_matches(session_id);
CREATE INDEX IF NOT EXISTS idx_session_pattern_matches_pattern ON session_pattern_matches(pattern_id);
CREATE INDEX IF NOT EXISTS idx_anti_patterns_severity ON anti_patterns(severity);
CREATE INDEX IF NOT EXISTS idx_anti_patterns_rule ON anti_patterns(detection_rule);
CREATE INDEX IF NOT EXISTS idx_anti_patterns_created ON anti_patterns(created_at);
CREATE INDEX IF NOT EXISTS idx_session_anti_pattern_matches_session ON session_anti_pattern_matches(session_id);
CREATE INDEX IF NOT EXISTS idx_session_anti_pattern_matches_pattern ON session_anti_pattern_matches(anti_pattern_id);
CREATE INDEX IF NOT EXISTS idx_playbooks_status ON playbooks(status);
CREATE INDEX IF NOT EXISTS idx_playbooks_created ON playbooks(created_at);
