-- Bash command timing: one row per Bash tool call, derived from tool.complete /
-- tool.fail at ingestion (db/commandQueries.ts), so slow and slowing commands
-- can be found per project over time.
--
-- No command text is stored. `signature` is what the plugin sends as
-- commandSignature (plugin 0.38.0+): the program and up to two plain words
-- ("bun run build", "docker compose up"); older plugins only send the program
-- (toolSubcommand). Reads name a signature or project only for sessions the
-- viewer may see (visibleSessionPredicate); other sessions count under their
-- program.
--
-- There is no developer_id or project column: both come from `sessions` at read
-- time, so retention anonymization applies. The row cascades away with its
-- event, so it never outlives the retention window of the event it came from.
CREATE TABLE IF NOT EXISTS command_runs (
  -- Claude Code's tool_use_id; `event:<event id>` for plugins that do not send one.
  tool_use_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  program TEXT NOT NULL,
  signature TEXT NOT NULL,
  in_subagent BOOLEAN NOT NULL DEFAULT FALSE,
  -- foreground: Claude waited for it to finish. background: run_in_background.
  -- moved: started in the foreground, backgrounded after its timeout or by the user.
  mode TEXT NOT NULL CHECK (mode IN ('foreground', 'background', 'moved')),
  started_at TIMESTAMPTZ NOT NULL,
  -- How long the session waited on it: all of a foreground command, and for a
  -- background one the time until it was backgrounded.
  wait_ms INTEGER NOT NULL CHECK (wait_ms >= 0),
  -- Start to finish. NULL while a background command is still running (or was
  -- never reported as settled).
  duration_ms INTEGER CHECK (duration_ms >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'failure', 'interrupted', 'running', 'killed')),
  exit_code INTEGER,
  finished_at TIMESTAMPTZ,
  -- Timed by the plugin's own clock (no duration_ms from Claude Code), which
  -- before plugin 0.38.0 mixed up parallel calls of one session.
  legacy_timing BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_command_runs_started ON command_runs (started_at);
CREATE INDEX IF NOT EXISTS idx_command_runs_session ON command_runs (session_id);
