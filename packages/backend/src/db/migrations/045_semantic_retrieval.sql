-- Semantic retrieval: prompt/response turns and their embeddings (pgvector).
--
-- Requires the pgvector extension files in the Postgres image
-- (docker/postgres.Dockerfile). Purely additive: no existing table is altered.
--
-- A "turn" is one prompt.submit plus the response.complete that closed it,
-- with the tool activity in between summarised as its outcome. Turns are
-- derived from events, so they cascade away when data retention purges the
-- underlying prompt event. No developer_id is stored here: retrieval always
-- joins through sessions, so org scoping and anonymisation stay authoritative.
-- Token usage is deliberately absent: response.complete carries cumulative
-- session totals, not per-turn usage (see updateSessionTokens).
--
-- Guarded: if the running image has no pgvector (backend deployed before the
-- database image swap), this whole migration is a no-op instead of failing
-- boot. The feature stays off until EMBEDDING_URL is set, and the next boot
-- after the swap creates everything.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    RAISE NOTICE 'pgvector not available; skipping semantic retrieval schema';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS vector;

  CREATE TABLE IF NOT EXISTS prompt_turns (
    id BIGSERIAL PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(id),
    prompt_event_id TEXT NOT NULL UNIQUE REFERENCES events(id) ON DELETE CASCADE,
    response_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
    prompt_at TIMESTAMPTZ NOT NULL,
    prompt_text TEXT NOT NULL,
    response_text TEXT,
    tool_calls INT NOT NULL DEFAULT 0,
    tool_failures INT NOT NULL DEFAULT 0,
    tools_used TEXT[] NOT NULL DEFAULT '{}',
    duration_ms BIGINT,
    built_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_prompt_turns_session
    ON prompt_turns (session_id, prompt_at);

  -- Backs the ON DELETE SET NULL above: without it, every event purged by
  -- data retention would seq-scan this table from the FK trigger.
  CREATE INDEX IF NOT EXISTS idx_prompt_turns_response_event
    ON prompt_turns (response_event_id) WHERE response_event_id IS NOT NULL;

  -- `model` is part of the key: vectors from different models are not
  -- comparable, so a model switch re-embeds alongside instead of mixing.
  CREATE TABLE IF NOT EXISTS turn_embeddings (
    turn_id BIGINT NOT NULL REFERENCES prompt_turns(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('prompt', 'response')),
    model TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    embedding vector(1024) NOT NULL,
    embedded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (turn_id, kind, model)
  );

  -- Texts the embedder rejected on their own (not as part of an outage).
  -- Excluded from the pending queue so one poison input can't wedge it.
  CREATE TABLE IF NOT EXISTS turn_embedding_failures (
    turn_id BIGINT NOT NULL REFERENCES prompt_turns(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('prompt', 'response')),
    model TEXT NOT NULL,
    failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (turn_id, kind, model)
  );

  -- Mean of a session's prompt vectors, per model.
  CREATE TABLE IF NOT EXISTS session_embeddings (
    session_id TEXT NOT NULL REFERENCES sessions(id),
    model TEXT NOT NULL,
    turn_count INT NOT NULL,
    embedding vector(1024) NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (session_id, model)
  );
END
$migration$;
