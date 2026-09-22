-- Workflow DNA: model-rated recovery and a per-intent breakdown.
--
-- recovery_quality: share of the week's failure episodes that TypeSafe rated
--   as "adapted" (the next calls changed tool or input) rather than retried
--   unchanged. NULL when TypeSafe was unavailable or there were too few rated
--   episodes; the dashboard then shows the heuristic recovery_speed instead.
--
-- by_intent: the same dimensions computed per session intent, keyed by
--   intent, for intents with enough confidently-classified sessions. NULL on
--   rows computed before this migration, which the job treats as "recompute".
ALTER TABLE workflow_profiles ADD COLUMN IF NOT EXISTS recovery_quality NUMERIC;
ALTER TABLE workflow_profiles ADD COLUMN IF NOT EXISTS by_intent JSONB;
