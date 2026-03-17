-- Migration 021: Support for new Claude Code hooks (PostCompact, Elicitation, InstructionsLoaded, TeammateIdle)

-- Track compaction count per session for PostCompact events
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS compaction_count INTEGER NOT NULL DEFAULT 0;

-- Distinguish CLAUDE.md files from .claude/rules/*.md in snapshots (for InstructionsLoaded)
ALTER TABLE claude_md_snapshots ADD COLUMN IF NOT EXISTS file_type TEXT DEFAULT 'claude_md';
UPDATE claude_md_snapshots SET file_type = 'claude_md' WHERE file_type IS NULL;
ALTER TABLE claude_md_snapshots ALTER COLUMN file_type SET NOT NULL;
ALTER TABLE claude_md_snapshots ALTER COLUMN file_type SET DEFAULT 'claude_md';

-- Index for efficient MCP elicitation analytics queries (B-tree on text extraction)
CREATE INDEX IF NOT EXISTS idx_events_mcp_server
  ON events ((payload->>'mcpServerName'))
  WHERE event_type IN ('elicitation.request', 'elicitation.response');
