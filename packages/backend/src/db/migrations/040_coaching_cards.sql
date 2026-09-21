-- Per-developer weekly coaching cards (self-only by design).
-- Each row is a snapshot of AI-generated recommendations for one developer for one week.
-- Access is enforced server-side: a card is visible only to the user linked to its developer_id.
CREATE TABLE IF NOT EXISTS coaching_cards (
  id TEXT PRIMARY KEY,
  developer_id TEXT NOT NULL REFERENCES developers(id) ON DELETE CASCADE,
  organization_id TEXT NOT NULL,
  week_start DATE NOT NULL,
  recommendations JSONB NOT NULL DEFAULT '[]',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  viewed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_coaching_cards_dev_week
  ON coaching_cards (developer_id, week_start);
CREATE INDEX IF NOT EXISTS idx_coaching_cards_dev
  ON coaching_cards (developer_id, week_start DESC);
CREATE INDEX IF NOT EXISTS idx_coaching_cards_org
  ON coaching_cards (organization_id, generated_at DESC);
