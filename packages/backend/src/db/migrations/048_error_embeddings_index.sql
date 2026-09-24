-- HNSW index for error recall. Index-only, so the runner defers it until after
-- the server is up.
CREATE INDEX IF NOT EXISTS idx_error_embeddings_hnsw
  ON error_embeddings USING hnsw (embedding vector_cosine_ops);
