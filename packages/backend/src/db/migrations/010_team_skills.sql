-- Team Skills: AI-generated SKILL.md files from session data
CREATE TABLE IF NOT EXISTS team_skills (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  trigger_phrases TEXT[] NOT NULL DEFAULT '{}',
  skill_body TEXT NOT NULL,
  source_pattern_ids TEXT[] NOT NULL DEFAULT '{}',
  source_anti_pattern_ids TEXT[] NOT NULL DEFAULT '{}',
  version INT NOT NULL DEFAULT 1,
  previous_version_id TEXT REFERENCES team_skills(id) ON DELETE SET NULL,
  generation_context JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','approved','active','archived')),
  approved_by TEXT,
  approved_at TIMESTAMPTZ,
  effectiveness_score FLOAT,
  adoption_count INT NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT 'auto',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS team_skill_pattern_links (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES team_skills(id) ON DELETE CASCADE,
  pattern_id TEXT REFERENCES session_patterns(id) ON DELETE SET NULL,
  anti_pattern_id TEXT REFERENCES anti_patterns(id) ON DELETE SET NULL,
  link_type TEXT NOT NULL CHECK (link_type IN ('source_pattern','anti_pattern_solution')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_team_skills_org ON team_skills(organization_id);
CREATE INDEX IF NOT EXISTS idx_team_skills_status ON team_skills(status);
CREATE INDEX IF NOT EXISTS idx_team_skills_created ON team_skills(created_at);
CREATE INDEX IF NOT EXISTS idx_tskl_skill ON team_skill_pattern_links(skill_id);
CREATE INDEX IF NOT EXISTS idx_tskl_pattern ON team_skill_pattern_links(pattern_id);
