-- GIN index for keyword search over turns (column from 053). Index-only, so
-- the migration runner defers it until after the server is up.
CREATE INDEX IF NOT EXISTS idx_prompt_turns_search_tsv
  ON prompt_turns USING gin (search_tsv);
