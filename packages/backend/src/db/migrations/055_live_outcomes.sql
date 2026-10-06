-- Outcome signals the devscope-live mod collects during a session.
--
-- turn_labels: whether a turn's work landed, from the developer's explicit
-- 👍 / partly / 👎 or inferred from their next prompt. A label names the
-- moment its turn started (the mod's clock, the same machine as the plugin's
-- event timestamps) and is matched to the nearest prompt_turns row at read
-- time, so it needs no turn id and survives turns being rebuilt.
--
-- session_vcs_links: commits and PRs a session produced, recorded by the mod
-- when a Bash `git commit` / `gh pr create` succeeds. PR state is resolved
-- on the developer's machine with `gh` and written back, so the backend
-- needs no GitHub credentials.
--
-- Both are self-only data about the developer's own sessions and cascade
-- away with them.
CREATE TABLE IF NOT EXISTS turn_labels (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  turn_started_at TIMESTAMPTZ NOT NULL,
  label TEXT NOT NULL CHECK (label IN ('up', 'partial', 'down')),
  source TEXT NOT NULL CHECK (source IN ('explicit', 'implicit')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_turn_labels_session
  ON turn_labels (session_id, turn_started_at);

CREATE TABLE IF NOT EXISTS session_vcs_links (
  id BIGSERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('commit', 'pr')),
  -- A commit sha, or a PR URL.
  ref TEXT NOT NULL,
  repo_remote TEXT,
  state TEXT NOT NULL DEFAULT 'unknown'
    CHECK (state IN ('unknown', 'open', 'merged', 'closed')),
  merged_at TIMESTAMPTZ,
  closed_at TIMESTAMPTZ,
  checked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (session_id, kind, ref)
);

CREATE INDEX IF NOT EXISTS idx_session_vcs_links_ref
  ON session_vcs_links (kind, ref);
