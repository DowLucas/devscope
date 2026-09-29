-- Prompt origin: who wrote a turn's prompt.
--
-- Not every prompt.submit is typed by the developer. Claude Code itself
-- injects background-task and subagent notifications as prompts, orchestrators
-- (Paperclip) wake agents with a templated payload, and /loop or scheduled
-- ticks re-fire the same text. Measured on the homelab corpus (2026-09-29):
-- 80% human, 17% harness, 2% agent, 1% scheduled. Analyses of the developer's
-- own work (clustering, friction, re-prompt detection) must filter on this.
--
--   human      typed by the developer
--   harness    injected by Claude Code: <task-notification>, <agent-message>,
--              <cross-session-message>, a compaction "Prior context digest"
--   agent      an orchestrator waking an agent (Paperclip wake/resume payloads)
--   scheduled  timer-driven: autonomous-loop / triage / verification ticks, and
--              /loop re-firing the previous prompt verbatim (the first /loop in
--              a session is typed by hand, so it stays human)
--
-- prompt_origin() is the single definition: buildTurns calls it for new turns
-- and the backfill below uses it for existing ones. Changing the rules means
-- CREATE OR REPLACE here plus `UPDATE prompt_turns SET origin = NULL` so the
-- backfill re-runs on the next boot.
--
-- Guarded like 045: prompt_turns only exists on images with pgvector.
CREATE OR REPLACE FUNCTION prompt_origin(prompt TEXT, prev_prompt TEXT)
RETURNS TEXT
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT CASE
    WHEN prompt ~ '^\s*-?\s*(## Paperclip (Wake Payload|Resume Delta)|You are agent [0-9a-f-]{36} )' THEN 'agent'
    WHEN prompt ~ '(AUTO-TRIAGE|VERIFICATION) TICK'
      OR prompt ~ '^\s*# Autonomous loop (tick|check)'
      OR prompt ~ '<<autonomous-loop'
      OR (prompt ~ '^\s*/loop\s' AND prompt = prev_prompt) THEN 'scheduled'
    WHEN prompt ~ '^\s*<(task-notification|agent-message|cross-session-message)[\s>]'
      OR prompt ~ '^\s*# Prior context digest' THEN 'harness'
    ELSE 'human'
  END
$$;

DO $migration$
BEGIN
  IF to_regclass('public.prompt_turns') IS NULL THEN
    RAISE NOTICE 'prompt_turns not present; skipping prompt origin';
    RETURN;
  END IF;

  ALTER TABLE prompt_turns ADD COLUMN IF NOT EXISTS origin TEXT;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prompt_turns_origin_check') THEN
    ALTER TABLE prompt_turns ADD CONSTRAINT prompt_turns_origin_check
      CHECK (origin IS NULL OR origin IN ('human', 'harness', 'agent', 'scheduled'));
  END IF;

  -- Idempotent: after the first boot this matches nothing.
  UPDATE prompt_turns t
  SET origin = prompt_origin(t.prompt_text, prev.prompt_text)
  FROM prompt_turns cur
  LEFT JOIN LATERAL (
    SELECT p.prompt_text FROM prompt_turns p
    WHERE p.session_id = cur.session_id
      AND (p.prompt_at, p.id) < (cur.prompt_at, cur.id)
    ORDER BY p.prompt_at DESC, p.id DESC
    LIMIT 1
  ) prev ON true
  WHERE cur.id = t.id AND t.origin IS NULL;
END
$migration$;
