-- Add tool_subcommand column to team_tool_topology for granular proficiency tracking.
-- e.g., Bash -> "git", "npm", "docker"; Read -> "ts", "json", "py"

ALTER TABLE team_tool_topology ADD COLUMN IF NOT EXISTS tool_subcommand TEXT;

-- Recreate unique index to include tool_subcommand.
-- COALESCE handles null subcommand (historical data / tools without subcommands).
DROP INDEX IF EXISTS idx_ttt_org_tool_period;
CREATE UNIQUE INDEX idx_ttt_org_tool_period
  ON team_tool_topology(organization_id, tool_name, COALESCE(tool_subcommand, ''), period_start, period_end);
