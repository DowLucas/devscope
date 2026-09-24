-- Error recall: embeddings of tool-failure messages (pgvector).
--
-- One row per tool.fail event with a usable error message, embedded from a
-- normalised form (paths, ids and long numbers masked) so the same failure in
-- a different file or run lands close by. Derived from events, so rows
-- cascade away when data retention purges the event. Private sessions are
-- never embedded (enforced by the indexing query). Purely additive.
--
-- Guarded like 045: a no-op on an image without pgvector.
DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    RAISE NOTICE 'pgvector not available; skipping error embeddings';
    RETURN;
  END IF;

  CREATE EXTENSION IF NOT EXISTS vector;

  CREATE TABLE IF NOT EXISTS error_embeddings (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    embedding vector(1024) NOT NULL,
    embedded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, model)
  );

  -- Messages the embedder rejected on their own; skipped from then on so one
  -- poison input can't wedge the queue (same as turn_embedding_failures).
  CREATE TABLE IF NOT EXISTS error_embedding_failures (
    event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    failed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (event_id, model)
  );
END
$migration$;
