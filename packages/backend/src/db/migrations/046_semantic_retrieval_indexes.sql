-- HNSW indexes for semantic retrieval. Index-only, so the migration runner
-- defers this file until after the server is up (building HNSW over the
-- backfill can take a while and must not block the healthcheck).
CREATE INDEX IF NOT EXISTS idx_turn_embeddings_prompt_hnsw
  ON turn_embeddings USING hnsw (embedding vector_cosine_ops)
  WHERE kind = 'prompt';
CREATE INDEX IF NOT EXISTS idx_turn_embeddings_response_hnsw
  ON turn_embeddings USING hnsw (embedding vector_cosine_ops)
  WHERE kind = 'response';
CREATE INDEX IF NOT EXISTS idx_session_embeddings_hnsw
  ON session_embeddings USING hnsw (embedding vector_cosine_ops);
