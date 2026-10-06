-- Full-text index over turns for keyword search (GET /api/similar/search).
--
-- Vector search alone is poor at exact key terms: identifiers, file names,
-- error strings. A stored tsvector lets search fuse a keyword ranking with
-- the KNN ranking. 'simple' config: no stemming or stopwords, which suits
-- code tokens and mixed-language prompts. The left() caps keep each half well
-- under tsvector's 1 MB limit; prompts are weighted above responses.
--
-- Guarded like 045: prompt_turns only exists on images with pgvector.
DO $migration$
BEGIN
  IF to_regclass('public.prompt_turns') IS NULL THEN
    RAISE NOTICE 'prompt_turns not present; skipping turn search tsvector';
    RETURN;
  END IF;

  ALTER TABLE prompt_turns ADD COLUMN IF NOT EXISTS search_tsv tsvector
    GENERATED ALWAYS AS (
      setweight(to_tsvector('simple'::regconfig, left(prompt_text, 100000)), 'A') ||
      setweight(to_tsvector('simple'::regconfig, left(coalesce(response_text, ''), 400000)), 'B')
    ) STORED;
END
$migration$;
