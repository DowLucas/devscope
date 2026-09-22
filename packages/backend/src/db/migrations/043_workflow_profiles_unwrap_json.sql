-- workflow_profiles.raw_metrics (and, briefly, by_intent) were written as
-- `${JSON.stringify(x)}::jsonb`. Bun.sql binds that string parameter as a JSON
-- string, so every row stored a jsonb *scalar string* holding the JSON text
-- rather than the object: jsonb_typeof() = 'string', and ->> / jsonb_* calls
-- on it fail or return nothing. The writer now passes objects; this unwraps
-- the rows already written. Idempotent: only string-typed values are touched.
UPDATE workflow_profiles
   SET raw_metrics = (raw_metrics #>> '{}')::jsonb
 WHERE jsonb_typeof(raw_metrics) = 'string';

UPDATE workflow_profiles
   SET by_intent = (by_intent #>> '{}')::jsonb
 WHERE by_intent IS NOT NULL AND jsonb_typeof(by_intent) = 'string';
